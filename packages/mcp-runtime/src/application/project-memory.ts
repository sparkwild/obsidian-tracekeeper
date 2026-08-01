import {
	KNOWLEDGE_SOURCES_DIR,
	KNOWLEDGE_PROJECTS_MEMORY_DIR,
	KNOWLEDGE_WIKI_DIR,
	OperationConflictError,
	PROJECT_MEMORY_ENTRY_SCHEMA_VERSION,
	PROJECT_MEMORY_ENTRY_TYPE,
	PROJECT_MEMORY_HUB_TYPE,
	buildProjectMemoryCatalogPage,
	buildProjectMemoryEntry,
	classifyProjectMemoryNote,
	compareProjectMemoryOperationHashes,
	deriveProjectMemoryHubBindingFromRepoPath,
	hashVaultContent,
	normalizeProjectAgentType,
	normalizeProjectRepositoryPath,
	normalizeVaultRelativePath,
	projectMemoryCatalogEntryFromClassification,
	resolveProjectMemoryNoteOwnership,
	startsWithPathPrefix,
	validateProjectMemoryOwnership,
	type ProjectMemoryCatalogPage,
	type ProjectMemoryEntry,
	type ProjectMemoryEntryStatus,
	type ProjectMemoryHubBinding,
	type ProjectMemoryNoteClassification,
	type ScanResult,
	type ScannedNote,
	type VaultRepository,
	type VaultWriteReceipt,
} from '@tracekeeper/core';

export interface ProjectMemoryHubProjection extends ProjectMemoryHubBinding {
	project_hint: string;
	backlinks: readonly string[];
}

export interface ProjectMemoryRelationProjection {
	hub_linked: boolean;
	resolved_targets: readonly string[];
	related_wiki: readonly string[];
	related_sources: readonly string[];
	backlinks: readonly string[];
}

export interface ProjectMemoryEntryProjection {
	entry: ProjectMemoryEntry;
	relations: ProjectMemoryRelationProjection;
}

export interface ProjectMemoryLegacyProjection {
	path: string;
	project_id: string;
	project_key: string;
	backlinks: readonly string[];
}

export interface ProjectMemorySnapshotProjection {
	generation: number;
	generation_source: 'native_index' | 'snapshot_fingerprint';
	index_state: 'initializing' | 'rebuilding' | 'ready' | 'filesystem_scan';
	hubs: readonly ProjectMemoryHubProjection[];
	entries: readonly ProjectMemoryEntryProjection[];
	legacy: readonly ProjectMemoryLegacyProjection[];
	unbound_hubs: readonly string[];
	issues: readonly ProjectMemorySnapshotIssue[];
}

export interface ProjectMemorySnapshotIssue {
	path: string;
	code:
		| 'invalid_project_memory_note'
		| 'ambiguous_entry_ownership'
		| 'ambiguous_legacy_ownership'
		| 'project_memory_scan_error';
}

export interface ProjectMemoryIdentityInput {
	projectId?: unknown;
	projectHint?: unknown;
	repoPath?: unknown;
}

export type ProjectMemoryReviewReason =
	| 'missing_exact_project_identity'
	| 'invalid_repo_path'
	| 'explicit_project_id_not_found'
	| 'conflicting_project_identity'
	| 'project_hint_conflict'
	| 'derived_project_key_occupied'
	| 'project_snapshot_incomplete';

export type ProjectMemoryWritableRoute =
	| {
			status: 'existing';
			binding: ProjectMemoryHubBinding;
	  }
	| {
			status: 'materialize';
			binding: ProjectMemoryHubBinding;
			project_hint: string;
	  }
	| {
			status: 'review_required';
			reason: ProjectMemoryReviewReason;
			warnings: readonly string[];
	  };

export interface ProjectMemoryCatalogInput {
	projectId: string;
	cursor?: string | null;
	pageSize?: number;
}

export interface ProjectMemoryApplicationDependencies {
	repository: ProjectMemoryVaultRepository;
	loadScan(): ScanResult | Promise<ScanResult>;
	now?(): string;
}

export interface ProjectMemoryVaultRepository extends VaultRepository {
	generateMarkdownLink?(
		targetPath: string,
		sourcePath: string,
		subpath?: string,
		alias?: string
	): string;
}

export interface CreateProjectMemoryEntryInput
	extends ProjectMemoryIdentityInput {
	agentType?: unknown;
	taskId?: string | null;
	operationId: string;
	operationKind: string;
	memoryKinds: readonly string[];
	status?: ProjectMemoryEntryStatus;
	body: string;
	relatedWikiPaths?: readonly string[];
	relatedSourcePaths?: readonly string[];
	supersedesPaths?: readonly string[];
	createdAt?: string;
}

export type ProjectMemoryHubResolution =
	| {
			status: 'ready';
			binding: ProjectMemoryHubBinding;
			hub_status: 'existing' | 'created' | 'exact_retry';
	  }
	| {
			status: 'review_required';
			reason: ProjectMemoryReviewReason;
			warnings: readonly string[];
	  };

export type ProjectMemoryEntryWriteResult =
	| {
			status: 'created' | 'exact_retry';
			path: string;
			project_id: string;
			project_hub: string;
			agent_type: string;
			operation_id: string;
			operation_kind: string;
			memory_kinds: readonly string[];
			operation_hash: string;
			hub_status: 'existing' | 'created' | 'exact_retry';
			receipt: VaultWriteReceipt | null;
	  }
	| {
			status: 'review_required';
			reason: ProjectMemoryReviewReason;
			warnings: readonly string[];
	  };

export class ProjectMemoryApplicationError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = 'ProjectMemoryApplicationError';
		this.code = code;
	}
}

export class ProjectMemoryEntryConflictError extends ProjectMemoryApplicationError {
	readonly path: string;
	readonly existingOperationHash: string | null;
	readonly requestedOperationHash: string;

	constructor(
		path: string,
		requestedOperationHash: string,
		existingOperationHash: string | null = null
	) {
		super(
			'project_memory_operation_conflict',
			`Project-memory operation already exists with a different operation hash: ${path}`
		);
		this.name = 'ProjectMemoryEntryConflictError';
		this.path = path;
		this.existingOperationHash = existingOperationHash;
		this.requestedOperationHash = requestedOperationHash;
	}
}

export function projectProjectMemorySnapshot(
	scan: ScanResult
): ProjectMemorySnapshotProjection {
	const notes = [...scan.notes].sort((left, right) =>
		left.relativePath.localeCompare(right.relativePath)
	);
	const issues: ProjectMemorySnapshotIssue[] = projectMemoryScanIssues(scan);
	const classifications: Array<{
		note: ScannedNote;
		classification: ProjectMemoryNoteClassification;
	}> = [];
	for (const note of notes) {
		try {
			classifications.push({
				note,
				classification: classifyProjectMemoryNote({
					path: note.relativePath,
					frontmatter: note.frontmatter,
				}),
			});
		} catch {
			if (
				startsWithPathPrefix(
					note.relativePath,
					KNOWLEDGE_PROJECTS_MEMORY_DIR
				)
			) {
				issues.push({
					path: note.relativePath,
					code: 'invalid_project_memory_note',
				});
				continue;
			}
			throw new ProjectMemoryApplicationError(
				'project_memory_snapshot_invalid',
				`The shared snapshot contains an invalid Vault path: ${note.relativePath}`
			);
		}
	}
	const hubClassifications = classifications.filter(
		(
			item
		): item is {
			note: ScannedNote;
			classification: Extract<ProjectMemoryNoteClassification, { kind: 'hub' }>;
		} => item.classification.kind === 'hub'
	);
	const bindings = validateProjectMemoryOwnership(
		hubClassifications.map((item) => item.classification.binding)
	);
	const bindingByPath = new Map(
		bindings.map((binding) => [binding.project_hub, binding])
	);
	const incoming = resolvedIncomingPaths(notes);
	const hubs = hubClassifications.map((item) => {
		const binding = bindingByPath.get(item.classification.path);
		if (!binding) {
			throw new ProjectMemoryApplicationError(
				'project_memory_snapshot_inconsistent',
				`Validated project-memory hub is missing from its snapshot: ${item.classification.path}`
			);
		}
		return {
			...binding,
			project_hint: frontmatterString(item.note.frontmatter.project_hint),
			backlinks: incoming.get(binding.project_hub) ?? [],
		};
	});
	const entries: ProjectMemoryEntryProjection[] = [];
	const legacy: ProjectMemoryLegacyProjection[] = [];
	const unboundHubs: string[] = [];

	for (const { note, classification } of classifications) {
		if (classification.kind === 'entry') {
			let binding: ProjectMemoryHubBinding;
			try {
				binding = resolveProjectMemoryNoteOwnership(
					classification,
					bindings
				);
			} catch {
				issues.push({
					path: classification.path,
					code: 'ambiguous_entry_ownership',
				});
				continue;
			}
			const resolvedTargets = resolvedTargetPaths(note);
			entries.push({
				entry: classification.entry,
				relations: {
					hub_linked: resolvedTargets.includes(binding.project_hub),
					resolved_targets: resolvedTargets,
					related_wiki: resolvedTargets.filter((target) =>
						startsWithPathPrefix(target, KNOWLEDGE_WIKI_DIR)
					),
					related_sources: resolvedTargets.filter((target) =>
						startsWithPathPrefix(target, KNOWLEDGE_SOURCES_DIR)
					),
					backlinks: incoming.get(classification.path) ?? [],
				},
			});
			continue;
		}
		if (classification.kind === 'legacy') {
			let binding: ProjectMemoryHubBinding;
			try {
				binding = resolveProjectMemoryNoteOwnership(
					classification,
					bindings
				);
			} catch {
				issues.push({
					path: classification.path,
					code: 'ambiguous_legacy_ownership',
				});
				continue;
			}
			legacy.push({
				path: classification.path,
				project_id: binding.project_id,
				project_key: binding.project_key,
				backlinks: incoming.get(classification.path) ?? [],
			});
			continue;
		}
		if (classification.kind === 'unbound_hub') {
			unboundHubs.push(classification.path);
		}
	}

	return {
		generation:
			scan.index?.generation ?? projectMemorySnapshotFingerprint(scan),
		generation_source: scan.index
			? 'native_index'
			: 'snapshot_fingerprint',
		index_state: scan.index?.index_state ?? 'filesystem_scan',
		hubs: hubs.sort((left, right) =>
			left.project_hub.localeCompare(right.project_hub)
		),
		entries: entries.sort((left, right) =>
			left.entry.path.localeCompare(right.entry.path)
		),
		legacy: legacy.sort((left, right) => left.path.localeCompare(right.path)),
		unbound_hubs: unboundHubs.sort(),
		issues: dedupeSnapshotIssues(issues),
	};
}

export function resolveProjectMemoryWritableRoute(
	snapshot: ProjectMemorySnapshotProjection,
	input: ProjectMemoryIdentityInput
): ProjectMemoryWritableRoute {
	const projectId = optionalString(input.projectId);
	const projectHint = optionalString(input.projectHint);
	const repoPathInput = optionalString(input.repoPath);
	let repoPath = '';
	if (repoPathInput) {
		try {
			repoPath = normalizeProjectRepositoryPath(repoPathInput);
		} catch {
			return reviewRequired('invalid_repo_path');
		}
	}

	const byId = projectId
		? snapshot.hubs.find((hub) => hub.project_id === projectId)
		: undefined;
	const byRepo = repoPath
		? snapshot.hubs.find((hub) => hub.repo_path === repoPath)
		: undefined;
	if (projectId && !byId) {
		return reviewRequired('explicit_project_id_not_found');
	}
	if (byId && byRepo && byId.project_id !== byRepo.project_id) {
		return reviewRequired('conflicting_project_identity');
	}

	const existing = byId ?? byRepo;
	if (existing) {
		if (repoPath && existing.repo_path !== repoPath) {
			return reviewRequired('conflicting_project_identity');
		}
		if (
			projectHint
			&& existing.project_hint
			&& normalizeProjectHint(existing.project_hint)
				!== normalizeProjectHint(projectHint)
		) {
			return reviewRequired('project_hint_conflict');
		}
		if (snapshotHasProjectIssue(snapshot, existing.project_hub)) {
			return reviewRequired('project_snapshot_incomplete');
		}
		return {
			status: 'existing',
			binding: projectMemoryHubBinding(existing),
		};
	}

	if (!repoPath) {
		return reviewRequired('missing_exact_project_identity');
	}
	const derived = deriveProjectMemoryHubBindingFromRepoPath(repoPath);
	if (
		snapshot.unbound_hubs.includes(derived.project_hub)
		|| snapshotHasProjectIssue(snapshot, derived.project_hub)
		|| snapshot.hubs.some(
			(hub) =>
				hub.project_id === derived.project_id
				|| hub.project_key === derived.project_key
				|| hub.project_hub === derived.project_hub
		)
	) {
		return reviewRequired('derived_project_key_occupied');
	}
	if (
		projectHint
		&& normalizeProjectHint(projectHint)
			!== normalizeProjectHint(derived.project_hint)
	) {
		return reviewRequired('project_hint_conflict');
	}
	return {
		status: 'materialize',
		binding: projectMemoryHubBinding(derived),
		project_hint: derived.project_hint,
	};
}

export function buildProjectMemoryCatalog(
	snapshot: ProjectMemorySnapshotProjection,
	input: ProjectMemoryCatalogInput
): ProjectMemoryCatalogPage {
	const hub = snapshot.hubs.find(
		(candidate) => candidate.project_id === input.projectId
	);
	if (!hub) {
		throw new ProjectMemoryApplicationError(
			'project_memory_identity_not_found',
			`Project-memory project_id is not present in the current snapshot: ${input.projectId}`
		);
	}
	if (snapshotHasProjectIssue(snapshot, hub.project_hub)) {
		throw new ProjectMemoryApplicationError(
			'project_memory_catalog_incomplete',
			'Project-memory catalog cannot prove completeness because this project has unreadable or ambiguous snapshot records.'
		);
	}
	const binding = projectMemoryHubBinding(hub);
	const entries = [
		...snapshot.entries
			.filter((row) => row.entry.project_id === binding.project_id)
			.map((row) =>
				projectMemoryCatalogEntryFromClassification(
					{
						kind: 'entry',
						path: row.entry.path,
						project_key: row.entry.project_key,
						project_id: row.entry.project_id,
						entry: row.entry,
					},
					binding
				)
			),
		...snapshot.legacy
			.filter((row) => row.project_id === binding.project_id)
			.map((row) =>
				projectMemoryCatalogEntryFromClassification(
					{
						kind: 'legacy',
						path: row.path,
						project_key: row.project_key,
						project_id: row.project_id,
					},
					binding
				)
			),
	];
	return buildProjectMemoryCatalogPage({
		projectId: binding.project_id,
		projectHub: binding.project_hub,
		generation: snapshot.generation,
		entries,
		cursor: input.cursor,
		pageSize: input.pageSize,
	});
}

export class ProjectMemoryApplicationService {
	private readonly repository: ProjectMemoryVaultRepository;
	private readonly loadScan: () => ScanResult | Promise<ScanResult>;
	private readonly now: () => string;

	constructor(dependencies: ProjectMemoryApplicationDependencies) {
		this.repository = dependencies.repository;
		this.loadScan = dependencies.loadScan;
		this.now = dependencies.now ?? (() => new Date().toISOString());
	}

	async snapshot(): Promise<ProjectMemorySnapshotProjection> {
		return projectProjectMemorySnapshot(await this.loadScan());
	}

	async listCatalog(
		input: ProjectMemoryCatalogInput
	): Promise<ProjectMemoryCatalogPage> {
		return buildProjectMemoryCatalog(await this.snapshot(), input);
	}

	async ensureWritableProject(
		input: ProjectMemoryIdentityInput
	): Promise<ProjectMemoryHubResolution> {
		const snapshot = await this.snapshot();
		return this.ensureWritableProjectFromSnapshot(snapshot, input);
	}

	async createImmutableEntry(
		input: CreateProjectMemoryEntryInput
	): Promise<ProjectMemoryEntryWriteResult> {
		const scan = await this.loadScan();
		const snapshot = projectProjectMemorySnapshot(scan);
		const project = await this.ensureWritableProjectFromSnapshot(snapshot, input);
		if (project.status === 'review_required') {
			return project;
		}

		const agentType = normalizeProjectAgentType(input.agentType);
		const relatedWikiPaths = verifyRelatedPaths(
			scan,
			input.relatedWikiPaths ?? [],
			KNOWLEDGE_WIKI_DIR,
			'related Wiki'
		);
		const relatedSourcePaths = verifyRelatedPaths(
			scan,
			input.relatedSourcePaths ?? [],
			KNOWLEDGE_SOURCES_DIR,
			'related Source'
		);
		const supersedesPaths = verifySupersedesPaths(
			snapshot,
			project.binding,
			input.supersedesPaths ?? []
		);
		const projectHubLink = canonicalWikiLink(project.binding.project_hub);
		const relatedWikiLinks = relatedWikiPaths.map(canonicalWikiLink);
		const supersedesLinks = supersedesPaths.map(canonicalWikiLink);
		const entryPathInput = {
			project_id: project.binding.project_id,
			project_key: project.binding.project_key,
			agent_type: agentType,
			task_id: input.taskId ?? null,
			operation_id: input.operationId,
			operation_kind: input.operationKind,
			memory_kinds: input.memoryKinds,
			status: input.status ?? 'active',
			created_at: input.createdAt ?? this.now(),
			project_hub: projectHubLink,
			related_wiki: relatedWikiLinks,
			supersedes: supersedesLinks,
		};
		const canonicalBody = renderProjectMemoryEntryBody({
			body: input.body,
			projectHubLink,
			relatedWikiLinks,
			relatedSourceLinks: relatedSourcePaths.map(canonicalWikiLink),
			supersedesLinks,
		});
		const built = buildProjectMemoryEntry({
			...entryPathInput,
			body: canonicalBody,
		});
		const renderedBody = renderProjectMemoryEntryBody({
			body: input.body,
			projectHubLink: this.markdownLink(
				project.binding.project_hub,
				built.entry.path
			),
			relatedWikiLinks: relatedWikiPaths.map((target) =>
				this.markdownLink(target, built.entry.path)
			),
			relatedSourceLinks: relatedSourcePaths.map((target) =>
				this.markdownLink(target, built.entry.path)
			),
			supersedesLinks: supersedesPaths.map((target) =>
				this.markdownLink(target, built.entry.path)
			),
		});
		const markdown = renderProjectMemoryEntryMarkdown(
			built.entry,
			renderedBody
		);

		try {
			const receipt = await this.repository.createText(
				built.entry.path,
				markdown
			);
			return entryWriteResult(
				'created',
				built.entry,
				project.hub_status,
				receipt
			);
		} catch (error: unknown) {
			if (!(error instanceof OperationConflictError)) {
				throw error;
			}
		}

		const refreshed = projectProjectMemorySnapshot(await this.loadScan());
		const existing = refreshed.entries.find(
			(row) => row.entry.path === built.entry.path
		)?.entry;
		if (existing) {
			if (existing.project_id !== built.entry.project_id) {
				throw new ProjectMemoryEntryConflictError(
					built.entry.path,
					built.entry.operation_hash,
					existing.operation_hash
				);
			}
			const comparison = compareProjectMemoryOperationHashes(
				existing.operation_hash,
				built.entry.operation_hash
			);
			if (comparison.status === 'exact_retry') {
				return entryWriteResult(
					'exact_retry',
					existing,
					project.hub_status,
					null
				);
			}
			throw new ProjectMemoryEntryConflictError(
				built.entry.path,
				comparison.requested_operation_hash,
				comparison.existing_operation_hash
			);
		}

		const repositoryEntry = await this.repository.readText(built.entry.path);
		if (repositoryEntry?.content === markdown) {
			return entryWriteResult(
				'exact_retry',
				built.entry,
				project.hub_status,
				null
			);
		}
		throw new ProjectMemoryEntryConflictError(
			built.entry.path,
			built.entry.operation_hash
		);
	}

	private async ensureWritableProjectFromSnapshot(
		snapshot: ProjectMemorySnapshotProjection,
		input: ProjectMemoryIdentityInput
	): Promise<ProjectMemoryHubResolution> {
		const route = resolveProjectMemoryWritableRoute(snapshot, input);
		if (route.status === 'review_required') {
			return route;
		}
		if (route.status === 'existing') {
			return {
				status: 'ready',
				binding: route.binding,
				hub_status: 'existing',
			};
		}

		const markdown = renderProjectMemoryHubMarkdown(
			route.binding,
			route.project_hint
		);
		try {
			await this.repository.createText(route.binding.project_hub, markdown);
			return {
				status: 'ready',
				binding: route.binding,
				hub_status: 'created',
			};
		} catch (error: unknown) {
			if (!(error instanceof OperationConflictError)) {
				throw error;
			}
		}

		const refreshed = projectProjectMemorySnapshot(await this.loadScan());
		const existing = refreshed.hubs.find(
			(hub) => hub.project_hub === route.binding.project_hub
		);
		if (existing && sameHubBinding(existing, route.binding)) {
			return {
				status: 'ready',
				binding: projectMemoryHubBinding(existing),
				hub_status: 'exact_retry',
			};
		}
		const repositoryHub = await this.repository.readText(
			route.binding.project_hub
		);
		if (repositoryHub?.content === markdown) {
			return {
				status: 'ready',
				binding: route.binding,
				hub_status: 'exact_retry',
			};
		}
		throw new ProjectMemoryApplicationError(
			'project_memory_hub_conflict',
			`Project-memory hub create lost to a conflicting binding: ${route.binding.project_hub}`
		);
	}

	private markdownLink(targetPath: string, sourcePath: string): string {
		if (this.repository.generateMarkdownLink) {
			return this.repository.generateMarkdownLink(targetPath, sourcePath);
		}
		return canonicalWikiLink(targetPath);
	}
}

function projectMemorySnapshotFingerprint(scan: ScanResult): number {
	const fingerprint = hashVaultContent(
		JSON.stringify({
			notes: [...scan.notes]
				.sort((left, right) =>
					left.relativePath.localeCompare(right.relativePath)
				)
				.map((note) => ({
					path: note.relativePath,
					content_hash: note.contentHash,
					modified_at: note.modifiedAt,
					size: note.size,
				})),
			errors: [...scan.errors]
				.sort((left, right) =>
					left.path.localeCompare(right.path)
						|| left.error.localeCompare(right.error)
				)
				.map((error) => ({
					path: normalizedScanErrorPath(scan, error.path) ?? 'outside_vault',
					error: error.error,
				})),
		})
	);
	return Number.parseInt(fingerprint.slice(0, 13), 16);
}

function projectMemoryScanIssues(
	scan: ScanResult
): ProjectMemorySnapshotIssue[] {
	const issues: ProjectMemorySnapshotIssue[] = [];
	for (const error of scan.errors) {
		const relativePath = normalizedScanErrorPath(scan, error.path);
		if (
			relativePath
			&& startsWithPathPrefix(
				relativePath,
				KNOWLEDGE_PROJECTS_MEMORY_DIR
			)
		) {
			issues.push({
				path: relativePath,
				code: 'project_memory_scan_error',
			});
		}
	}
	return issues;
}

function normalizedScanErrorPath(
	scan: ScanResult,
	value: string
): string | null {
	const raw = value.trim().replace(/\\/g, '/');
	const vaultRoot = scan.vaultRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '');
	let candidate = raw;
	if (vaultRoot && raw.startsWith(`${vaultRoot}/`)) {
		candidate = raw.slice(vaultRoot.length + 1);
	} else if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) {
		return null;
	}
	try {
		return normalizeVaultRelativePath(candidate);
	} catch {
		return null;
	}
}

function dedupeSnapshotIssues(
	issues: readonly ProjectMemorySnapshotIssue[]
): ProjectMemorySnapshotIssue[] {
	const byIdentity = new Map<string, ProjectMemorySnapshotIssue>();
	for (const issue of issues) {
		byIdentity.set(`${issue.path}\0${issue.code}`, issue);
	}
	return [...byIdentity.values()].sort(
		(left, right) =>
			left.path.localeCompare(right.path)
				|| left.code.localeCompare(right.code)
	);
}

function snapshotHasProjectIssue(
	snapshot: ProjectMemorySnapshotProjection,
	projectHub: string
): boolean {
	const projectRoot = projectHub.replace(/\/index\.md$/i, '');
	return snapshot.issues.some((issue) =>
		startsWithPathPrefix(issue.path, projectRoot)
	);
}

function resolvedIncomingPaths(
	notes: readonly ScannedNote[]
): ReadonlyMap<string, readonly string[]> {
	const incoming = new Map<string, Set<string>>();
	for (const note of notes) {
		for (const target of resolvedTargetPaths(note)) {
			const sources = incoming.get(target) ?? new Set<string>();
			sources.add(note.relativePath);
			incoming.set(target, sources);
		}
	}
	return new Map(
		[...incoming.entries()].map(([target, sources]) => [
			target,
			[...sources].sort(),
		])
	);
}

function resolvedTargetPaths(note: ScannedNote): string[] {
	const targets = new Set<string>();
	for (const edge of note.edges) {
		if (edge.resolution.status === 'resolved') {
			targets.add(normalizeVaultRelativePath(edge.resolution.path));
		}
	}
	return [...targets].sort();
}

function frontmatterString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function normalizeProjectHint(value: string): string {
	return value.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
}

function reviewRequired(
	reason: ProjectMemoryReviewReason
): Extract<ProjectMemoryWritableRoute, { status: 'review_required' }> {
	return {
		status: 'review_required',
		reason,
		warnings: [reason],
	};
}

function projectMemoryHubBinding(
	input: ProjectMemoryHubBinding
): ProjectMemoryHubBinding {
	return {
		project_id: input.project_id,
		project_key: input.project_key,
		project_hub: input.project_hub,
		repo_path: input.repo_path,
	};
}

function sameHubBinding(
	left: ProjectMemoryHubBinding,
	right: ProjectMemoryHubBinding
): boolean {
	return (
		left.project_id === right.project_id
		&& left.project_key === right.project_key
		&& left.project_hub === right.project_hub
		&& left.repo_path === right.repo_path
	);
}

function verifyRelatedPaths(
	scan: ScanResult,
	values: readonly string[],
	requiredPrefix: string,
	label: string
): string[] {
	const notePaths = new Set(scan.notes.map((note) => note.relativePath));
	const result = new Set<string>();
	for (const value of values) {
		const target = normalizeVaultRelativePath(value);
		if (!startsWithPathPrefix(target, requiredPrefix) || !notePaths.has(target)) {
			throw new ProjectMemoryApplicationError(
				'project_memory_unverified_relation',
				`Project-memory ${label} path is not verified by the current snapshot: ${target}`
			);
		}
		result.add(target);
	}
	return [...result].sort();
}

function verifySupersedesPaths(
	snapshot: ProjectMemorySnapshotProjection,
	binding: ProjectMemoryHubBinding,
	values: readonly string[]
): string[] {
	const validPaths = new Set(
		snapshot.entries
			.filter((row) => row.entry.project_id === binding.project_id)
			.map((row) => row.entry.path)
	);
	const result = new Set<string>();
	for (const value of values) {
		const target = normalizeVaultRelativePath(value);
		if (!validPaths.has(target)) {
			throw new ProjectMemoryApplicationError(
				'project_memory_invalid_supersedes',
				`Project-memory supersedes path is not an existing entry in this project: ${target}`
			);
		}
		result.add(target);
	}
	return [...result].sort();
}

function canonicalWikiLink(targetPath: string): string {
	const normalized = normalizeVaultRelativePath(targetPath);
	return `[[${normalized.replace(/\.md$/i, '')}]]`;
}

function renderProjectMemoryHubMarkdown(
	binding: ProjectMemoryHubBinding,
	projectHint: string
): string {
	return [
		'---',
		`schema_version: ${PROJECT_MEMORY_ENTRY_SCHEMA_VERSION}`,
		`type: ${PROJECT_MEMORY_HUB_TYPE}`,
		`project_id: ${yamlValue(binding.project_id)}`,
		`project_key: ${yamlValue(binding.project_key)}`,
		`project_hint: ${yamlValue(projectHint)}`,
		`repo_path: ${yamlValue(binding.repo_path)}`,
		'---',
		'',
		`# Project memory: ${projectHint}`,
		'',
		'Project memory entries link back to this hub.',
		'',
	].join('\n');
}

function renderProjectMemoryEntryMarkdown(
	entry: ProjectMemoryEntry,
	body: string
): string {
	return [
		'---',
		`schema_version: ${PROJECT_MEMORY_ENTRY_SCHEMA_VERSION}`,
		`type: ${PROJECT_MEMORY_ENTRY_TYPE}`,
		`project_id: ${yamlValue(entry.project_id)}`,
		`agent_type: ${yamlValue(entry.agent_type)}`,
		`task_id: ${entry.task_id === null ? 'null' : yamlValue(entry.task_id)}`,
		`operation_id: ${yamlValue(entry.operation_id)}`,
		`operation_kind: ${yamlValue(entry.operation_kind)}`,
		`memory_kinds: ${yamlValue(entry.memory_kinds)}`,
		`status: ${yamlValue(entry.status)}`,
		`created_at: ${yamlValue(entry.created_at)}`,
		`operation_hash: ${yamlValue(entry.operation_hash)}`,
		`project_hub: ${yamlValue(entry.project_hub)}`,
		`related_wiki: ${yamlValue(entry.related_wiki)}`,
		`supersedes: ${yamlValue(entry.supersedes)}`,
		'---',
		'',
		body,
		'',
	].join('\n');
}

function renderProjectMemoryEntryBody(input: {
	body: string;
	projectHubLink: string;
	relatedWikiLinks: readonly string[];
	relatedSourceLinks: readonly string[];
	supersedesLinks: readonly string[];
}): string {
	const relationLines = [
		`- Project hub: ${input.projectHubLink}`,
		...input.relatedWikiLinks.map((link) => `- Wiki: ${link}`),
		...input.relatedSourceLinks.map((link) => `- Source: ${link}`),
		...input.supersedesLinks.map((link) => `- Supersedes: ${link}`),
	];
	return [
		'# Project memory entry',
		'',
		'## Relations',
		'',
		...relationLines,
		'',
		'## Memory',
		'',
		input.body.replace(/\r\n?/g, '\n').trim(),
	].join('\n');
}

function yamlValue(value: unknown): string {
	return JSON.stringify(value);
}

function entryWriteResult(
	status: 'created' | 'exact_retry',
	entry: ProjectMemoryEntry,
	hubStatus: 'existing' | 'created' | 'exact_retry',
	receipt: VaultWriteReceipt | null
): Extract<ProjectMemoryEntryWriteResult, { status: 'created' | 'exact_retry' }> {
	return {
		status,
		path: entry.path,
		project_id: entry.project_id,
		project_hub: entry.project_hub.replace(/^\[\[|\]\]$/g, '') + '.md',
		agent_type: entry.agent_type,
		operation_id: entry.operation_id,
		operation_kind: entry.operation_kind,
		memory_kinds: [...entry.memory_kinds],
		operation_hash: entry.operation_hash,
		hub_status: hubStatus,
		receipt,
	};
}
