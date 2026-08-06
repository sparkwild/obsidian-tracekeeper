import {
	RecoverableOperationRunner,
	type OperationFailureInjection,
	type OperationJournal,
} from '@tracekeeper/core';

export interface CaptureSourceRawRequest {
	source?: unknown;
	source_kind?: unknown;
	capture_reason?: unknown;
	task_id?: unknown;
	related_project?: unknown;
	mode?: unknown;
	filename?: unknown;
	title?: unknown;
	content?: unknown;
	text?: unknown;
}

export interface CaptureSourceOperationIdentity {
	operationId: string;
	idempotencyKey: string;
}

export interface CaptureSourceNote {
	path: string;
	activity_path: string;
	status: string;
	warnings: string[];
}

export interface CaptureSourceWriteInput {
	filename: string;
	frontmatter: Record<string, unknown>;
	body: string;
	taskId: string | null;
	metadata: Record<string, unknown>;
	operationId: string;
}

export interface CaptureSourceApplicationDependencies {
	journal: OperationJournal;
	failureInjection?: OperationFailureInjection;
	createIdentity(requestHash: string, idempotencyKey: string): CaptureSourceOperationIdentity;
	now(): string;
	buildFilename(rawFilename: unknown, fallbackPrefix: string): string;
	renderText(zh: string, en: string): string;
	assertSafeText(values: Array<{ label: string; value: string }>): void;
	findOwnedSourceNote(filename: string, operationId: string): Promise<CaptureSourceNote | null>;
	writeSourceNote(input: CaptureSourceWriteInput): Promise<CaptureSourceNote>;
	updateTaskSourceCapture(taskId: string | null, sourcePath: string): Promise<void>;
}

export interface CaptureSourceApplicationRequest {
	rawArgs: CaptureSourceRawRequest;
	requestHash: string;
	idempotencyKey: string;
}

export interface CaptureSourceApplicationResult {
	ok: true;
	tool: 'tracekeeper.capture_source';
	operation_id: string;
	idempotency_key: string;
	status: string;
	path: string;
	activity_path: string;
	warnings: string[];
	metadata: {
		source: string;
		mode: CaptureSourceMode;
	};
}

type CaptureSourceMode = 'external_reference' | 'extracted_snapshot' | 'local_copy';

function optionalString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function requiredString(value: unknown, field: string): string {
	const normalized = optionalString(value);
	if (!normalized) {
		throw new Error(`Missing required string argument: ${field}.`);
	}
	return normalized;
}

function captureMode(value: unknown): CaptureSourceMode {
	const mode = requiredString(value, 'mode').toLowerCase();
	switch (mode) {
		case 'external_reference':
		case 'extracted_snapshot':
		case 'local_copy':
			return mode;
		default:
			throw new Error(
				'capture_source mode must be one of: external_reference | extracted_snapshot | local_copy'
			);
	}
}

export class CaptureSourceApplicationService {
	private readonly dependencies: CaptureSourceApplicationDependencies;

	constructor(dependencies: CaptureSourceApplicationDependencies) {
		this.dependencies = dependencies;
	}

	async execute(
		request: CaptureSourceApplicationRequest
	): Promise<CaptureSourceApplicationResult> {
		const identity = this.dependencies.createIdentity(
			request.requestHash,
			request.idempotencyKey
		);
		const runner = new RecoverableOperationRunner<
			{ request_hash: string },
			CaptureSourceApplicationResult
		>({
			operationId: identity.operationId,
			idempotencyKey: identity.idempotencyKey,
			payload: { request_hash: request.requestHash },
			journal: this.dependencies.journal,
			failureInjection: this.dependencies.failureInjection,
			steps: [],
			finalize: () => this.finalize(request.rawArgs, identity),
		});
		return runner.run();
	}

	private async finalize(
		rawArgs: CaptureSourceRawRequest,
		identity: CaptureSourceOperationIdentity
	): Promise<CaptureSourceApplicationResult> {
		const source = requiredString(rawArgs.source, 'source');
		const sourceKind = optionalString(rawArgs.source_kind);
		const mode = captureMode(rawArgs.mode);
		const captureReason = optionalString(rawArgs.capture_reason);
		const relatedProject = optionalString(rawArgs.related_project);
		const filename = this.dependencies.buildFilename(
			rawArgs.filename,
			`source-${identity.operationId}`
		);
		const title = optionalString(rawArgs.title);
		const taskId = optionalString(rawArgs.task_id) || null;
		const now = this.dependencies.now();
		const warnings: string[] = [];
		const sourceText = optionalString(rawArgs.content) || optionalString(rawArgs.text);

		if (mode !== 'external_reference' && !sourceText) {
			throw new Error(`content/text is required when mode is "${mode}".`);
		}
		if (mode === 'external_reference' && sourceText) {
			warnings.push('content/text is ignored for external_reference mode.');
		}
		this.dependencies.assertSafeText([
			{ label: 'source', value: source },
			{ label: 'capture_reason', value: captureReason },
			{ label: 'content', value: sourceText },
			{ label: 'title', value: title },
		]);

		let body = `${this.dependencies.renderText('## 来源捕获', '## Source capture')}\n\n`;
		if (mode === 'external_reference') {
			body += `- mode: external_reference\n- source: ${source}\n`;
			if (sourceKind) {
				body += `- source_kind: ${sourceKind}\n`;
			}
			if (captureReason) {
				body += `- capture_reason: ${captureReason}\n`;
			}
		} else {
			body += `- mode: ${mode}\n- source: ${source}\n`;
			if (sourceKind) {
				body += `- source_kind: ${sourceKind}\n`;
			}
			body += `\n${sourceText}\n`;
		}

		const existing = await this.dependencies.findOwnedSourceNote(
			filename,
			identity.operationId
		);
		const note = existing || await this.dependencies.writeSourceNote({
			filename,
			frontmatter: {
				tool: 'tracekeeper.capture_source',
				type: 'source_capture',
				title: title || `source_${mode}`,
				source,
				source_kind: sourceKind || null,
				mode,
				capture_reason: captureReason || null,
				related_project: relatedProject || null,
				created_at: now,
				task_id: taskId || null,
				source_operation_id: identity.operationId,
			},
			body,
			taskId,
			metadata: { target_type: 'source_capture', mode },
			operationId: identity.operationId,
		});

		await this.dependencies.updateTaskSourceCapture(taskId, note.path);
		return {
			ok: true,
			tool: 'tracekeeper.capture_source',
			operation_id: identity.operationId,
			idempotency_key: identity.idempotencyKey,
			status: note.status,
			path: note.path,
			activity_path: note.activity_path,
			warnings,
			metadata: { source, mode },
		};
	}
}
