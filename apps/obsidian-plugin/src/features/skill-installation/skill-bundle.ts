import { createHash } from 'node:crypto';
import skillEntrypoint from '../../../../../skills/tracekeeper/SKILL.md';
import workflowStateMachine from '../../../../../skills/tracekeeper/references/workflow-state-machine.md';
import ingestionWorkflow from '../../../../../skills/tracekeeper/references/ingestion-workflow.md';
import failureRecovery from '../../../../../skills/tracekeeper/references/failure-recovery.md';
import closeoutFields from '../../../../../skills/tracekeeper/references/closeout-fields.md';
import instructionIsolation from '../../../../../skills/tracekeeper/references/instruction-isolation.md';
import flattenedSkill from '../../../../../skills/tracekeeper/dist/tracekeeper.flattened.md';
import manifestText from '../../../../../skills/tracekeeper/manifest.json';

export interface SkillManifestFile {
	path: string;
	sha256: string;
}

export interface TracekeeperSkillManifest {
	format_version: number;
	name: string;
	skill_version: string;
	workflow_contract_version: number;
	minimum_tracekeeper_version: string;
	hash_algorithm: string;
	bundle_hash: string;
	files: SkillManifestFile[];
	artifacts: {
		flattened: SkillManifestFile;
	};
}

export interface EmbeddedTracekeeperSkillBundle {
	manifest: TracekeeperSkillManifest;
	manifestText: string;
	flattened: string;
	sourceFiles: Readonly<Record<string, string>>;
	installFiles: Readonly<Record<string, string>>;
}

const sourceFiles: Record<string, string> = {
	'SKILL.md': normalizeText(skillEntrypoint),
	'references/workflow-state-machine.md': normalizeText(workflowStateMachine),
	'references/ingestion-workflow.md': normalizeText(ingestionWorkflow),
	'references/failure-recovery.md': normalizeText(failureRecovery),
	'references/closeout-fields.md': normalizeText(closeoutFields),
	'references/instruction-isolation.md': normalizeText(instructionIsolation),
};

export const TRACEKEEPER_SKILL_BUNDLE = buildEmbeddedBundle(
	normalizeText(manifestText),
	normalizeText(flattenedSkill),
	sourceFiles
);

export function normalizeSkillFileContent(value: string): string {
	return normalizeText(value);
}

export function hashSkillFileContent(value: string): string {
	return `sha256:${createHash('sha256').update(normalizeText(value), 'utf8').digest('hex')}`;
}

function buildEmbeddedBundle(
	embeddedManifestText: string,
	flattened: string,
	embeddedSources: Record<string, string>
): EmbeddedTracekeeperSkillBundle {
	const manifest = parseManifest(embeddedManifestText);
	const expectedPaths = Object.keys(embeddedSources);
	const listedPaths = manifest.files.map((file) => file.path);
	if (new Set(listedPaths).size !== listedPaths.length
		|| expectedPaths.length !== listedPaths.length
		|| expectedPaths.some((filePath, index) => filePath !== listedPaths[index])) {
		throw new Error('Embedded Tracekeeper Skill manifest source list does not match the bundled files.');
	}

	for (const file of manifest.files) {
		assertSafeRelativePath(file.path);
		if (hashSkillFileContent(embeddedSources[file.path]) !== file.sha256) {
			throw new Error(`Embedded Tracekeeper Skill source hash mismatch: ${file.path}`);
		}
	}
	const canonicalBundle = [
		`tracekeeper-skill-bundle-v${manifest.format_version}`,
		...manifest.files.map((file) => `${file.path}\0${file.sha256}`),
		'',
	].join('\n');
	const bundleHash = `sha256:${createHash('sha256').update(canonicalBundle, 'utf8').digest('hex')}`;
	if (bundleHash !== manifest.bundle_hash) {
		throw new Error('Embedded Tracekeeper Skill bundle hash mismatch.');
	}
	assertSafeRelativePath(manifest.artifacts.flattened.path);
	if (hashSkillFileContent(flattened) !== manifest.artifacts.flattened.sha256) {
		throw new Error('Embedded Tracekeeper flattened artifact hash mismatch.');
	}

	const installFiles = {
		...embeddedSources,
		'manifest.json': embeddedManifestText,
		[manifest.artifacts.flattened.path]: flattened,
	};
	for (const [filePath, content] of Object.entries(installFiles)) {
		assertSafeRelativePath(filePath);
		assertNoCredentialValue(content, filePath);
	}

	return Object.freeze({
		manifest,
		manifestText: embeddedManifestText,
		flattened,
		sourceFiles: Object.freeze({ ...embeddedSources }),
		installFiles: Object.freeze(installFiles),
	});
}

function parseManifest(value: string): TracekeeperSkillManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error('Embedded Tracekeeper Skill manifest is invalid JSON.');
	}
	if (!isRecord(parsed)
		|| parsed.name !== 'tracekeeper'
		|| parsed.skill_version !== '2.1.0'
		|| parsed.workflow_contract_version !== 3
		|| parsed.minimum_tracekeeper_version !== '0.2.4'
		|| parsed.hash_algorithm !== 'sha256'
		|| !Array.isArray(parsed.files)
		|| !isRecord(parsed.artifacts)
		|| !isRecord(parsed.artifacts.flattened)) {
		throw new Error('Embedded Tracekeeper Skill manifest has an unsupported shape.');
	}
	return parsed as unknown as TracekeeperSkillManifest;
}

function normalizeText(value: string): string {
	return `${value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trimEnd()}\n`;
}

function assertSafeRelativePath(filePath: string): void {
	if (!filePath
		|| filePath.startsWith('/')
		|| filePath.includes('\\')
		|| filePath.split('/').includes('..')) {
		throw new Error(`Unsafe Tracekeeper Skill bundle path: ${filePath}`);
	}
}

function assertNoCredentialValue(content: string, filePath: string): void {
	const credentialValue = /(?:sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{6,}\.|(?:api[_-]?key|access[_-]?token|authorization|bearer)\s*[:=]\s*["'`]?[A-Za-z0-9._-]{12,})/i;
	if (credentialValue.test(content)) {
		throw new Error(`Tracekeeper Skill bundle contains a credential-like value: ${filePath}`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
