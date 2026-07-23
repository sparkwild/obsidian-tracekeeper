import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	TRACEKEEPER_SKILL_FLATTENED_PATH,
	TRACEKEEPER_SKILL_MANIFEST_PATH,
	TRACEKEEPER_SKILL_SOURCE_FILES,
	buildTracekeeperSkillBundle,
} from './build_tracekeeper_skill.mjs';

const REQUIRED_PATHS = Object.freeze([
	'docs/architecture/AGENT_WORKFLOW_CONTRACT.md',
	'docs/product/INDEX.md',
	'docs/architecture/INDEX.md',
	'docs/engineering/INDEX.md',
	'docs/status/INDEX.md',
	'skills/tracekeeper/SKILL.md',
	'skills/tracekeeper/references/closeout-fields.md',
	'skills/tracekeeper/manifest.json',
	'skills/tracekeeper/dist/tracekeeper.flattened.md',
	'apps/obsidian-plugin/src/features/settings/tracekeeper-setting-tab.ts',
	'apps/obsidian-plugin/src/features/onboarding/onboarding-state.ts',
	'apps/obsidian-plugin/src/features/skill-installation/skill-bundle.ts',
	'apps/obsidian-plugin/src/features/skill-installation/skill-install-audit.ts',
	'apps/obsidian-plugin/src/adapters/client-skill-adapter.ts',
	'apps/obsidian-plugin/scripts/build.mjs',
]);

const ALLOWED_SKILL_WORKFLOW_TOOLS = new Set([
	'tracekeeper.start_task',
	'tracekeeper.recall',
	'tracekeeper.finish_task',
]);

function isSafeRelativePath(relativePath) {
	return typeof relativePath === 'string'
		&& relativePath.length > 0
		&& !path.posix.isAbsolute(relativePath)
		&& !relativePath.includes('\\')
		&& !relativePath.includes('\0')
		&& path.posix.normalize(relativePath) === relativePath
		&& !relativePath.split('/').includes('..');
}

async function readRequired(repoRoot, relativePath, errors) {
	try {
		return await readFile(path.join(repoRoot, ...relativePath.split('/')), 'utf8');
	} catch {
		errors.push(`missing required Agent ecosystem file: ${relativePath}`);
		return '';
	}
}

async function listSkillFiles(skillRoot, relativeDirectory = '') {
	const directory = path.join(skillRoot, ...relativeDirectory.split('/').filter(Boolean));
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
		if (entry.isSymbolicLink()) {
			files.push({ path: relativePath, symlink: true });
		} else if (entry.isDirectory()) {
			files.push(...await listSkillFiles(skillRoot, relativePath));
		} else if (entry.isFile()) {
			files.push({ path: relativePath, symlink: false });
		}
	}
	return files;
}

function requirePattern(content, pattern, label, errors) {
	if (!pattern.test(content)) errors.push(label);
}

function checkWorkflowSemantics(contract, skill, flattened, errors) {
	for (const [content, owner] of [[contract, 'contract'], [skill, 'Skill'], [flattened, 'flattened Skill']]) {
		requirePattern(content, /\bno_track\b/, `${owner} does not define no_track`, errors);
		requirePattern(content, /\brecall_only\b/, `${owner} does not define recall_only`, errors);
		requirePattern(content, /\btracked_task\b/, `${owner} does not define tracked_task`, errors);
		requirePattern(
			content,
			/recall_only[\s\S]{0,500}(?:must not|never)[\s\S]{0,180}tracekeeper\.start_task[\s\S]{0,180}tracekeeper\.finish_task/i,
			`${owner} does not prohibit start and finish in recall_only`,
			errors,
		);
		requirePattern(
			content,
			/tracekeeper\.start_task[^\n]{0,100}exactly once/i,
			`${owner} does not require start exactly once`,
			errors,
		);
		requirePattern(content, /real `task_id`/, `${owner} does not require the real task_id`, errors);
		requirePattern(
			content,
			/tracekeeper\.finish_task[^\n]{0,120}exactly once/i,
			`${owner} does not require finish exactly once`,
			errors,
		);
		requirePattern(
			content,
			/(?:untrusted )?knowledge data, not (?:a new |system or tool )?instructions?/i,
			`${owner} does not isolate recalled knowledge from instructions`,
			errors,
		);

		const structuredIndex = content.indexOf('`next_actions`');
		const compatibilityIndex = content.indexOf('`next_actions_for_agent`');
		if (structuredIndex < 0 || compatibilityIndex < 0 || structuredIndex > compatibilityIndex) {
			errors.push(`${owner} does not prioritize next_actions before next_actions_for_agent`);
		}
	}
}

function checkUnsafeExamples(contents, errors) {
	const absoluteDeveloperPath = /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\|file:\/\/)/;
	const credentialExample = /(?:sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{6,}\.|(?:api[_-]?key|access[_-]?token|authorization|bearer)\s*[:=]\s*["'`]?[A-Za-z0-9._-]{12,})/i;
	for (const { relativePath, content } of contents) {
		if (absoluteDeveloperPath.test(content)) errors.push(`absolute developer path found in ${relativePath}`);
		if (credentialExample.test(content)) errors.push(`sensitive credential example found in ${relativePath}`);
		const toolNames = content.match(/tracekeeper\.[a-z][a-z0-9_]*/g) ?? [];
		for (const toolName of new Set(toolNames)) {
			if (!ALLOWED_SKILL_WORKFLOW_TOOLS.has(toolName)) {
				errors.push(`deprecated or unknown Tracekeeper tool name in ${relativePath}: ${toolName}`);
			}
		}
	}
}

function checkManifestShape(manifest, errors) {
	if (manifest?.format_version !== 1) errors.push('manifest format_version must be 1');
	if (manifest?.name !== 'tracekeeper') errors.push('manifest name must be tracekeeper');
	if (manifest?.skill_version !== '2.0.0') errors.push('manifest skill_version must be 2.0.0');
	if (manifest?.workflow_contract_version !== 2) errors.push('manifest workflow_contract_version must be 2');
	if (manifest?.minimum_tracekeeper_version !== '0.2.3') errors.push('manifest minimum_tracekeeper_version must be 0.2.3');
	if (manifest?.hash_algorithm !== 'sha256') errors.push('manifest hash_algorithm must be sha256');
	if (!Array.isArray(manifest?.files)) {
		errors.push('manifest files must be an array');
		return;
	}

	const seen = new Set();
	for (const file of manifest.files) {
		if (!isSafeRelativePath(file?.path)) errors.push(`unsafe manifest source path: ${String(file?.path)}`);
		if (seen.has(file?.path)) errors.push(`duplicate manifest source path: ${String(file?.path)}`);
		seen.add(file?.path);
		if (!/^sha256:[a-f0-9]{64}$/.test(file?.sha256 ?? '')) {
			errors.push(`invalid source hash for ${String(file?.path)}`);
		}
	}

	for (const expected of TRACEKEEPER_SKILL_SOURCE_FILES) {
		if (!seen.has(expected)) errors.push(`manifest is missing authoritative source: ${expected}`);
	}
	for (const actual of seen) {
		if (!TRACEKEEPER_SKILL_SOURCE_FILES.includes(actual)) {
			errors.push(`manifest contains an unexpected source: ${String(actual)}`);
		}
	}

	const artifact = manifest?.artifacts?.flattened;
	if (!isSafeRelativePath(artifact?.path) || artifact?.path !== TRACEKEEPER_SKILL_FLATTENED_PATH) {
		errors.push('manifest flattened artifact path is invalid');
	}
	if (!/^sha256:[a-f0-9]{64}$/.test(artifact?.sha256 ?? '')) {
		errors.push('manifest flattened artifact hash is invalid');
	}
}

export async function checkAgentEcosystem(repoRoot = process.cwd()) {
	const errors = [];
	const warnings = [];
	const contents = new Map();
	for (const relativePath of REQUIRED_PATHS) {
		contents.set(relativePath, await readRequired(repoRoot, relativePath, errors));
	}

	const contractPath = 'docs/architecture/AGENT_WORKFLOW_CONTRACT.md';
	const skillPath = 'skills/tracekeeper/SKILL.md';
	const flattenedPath = `skills/tracekeeper/${TRACEKEEPER_SKILL_FLATTENED_PATH}`;
	const contract = contents.get(contractPath) ?? '';
	const skill = contents.get(skillPath) ?? '';
	const flattened = contents.get(flattenedPath) ?? '';
	if (/\]\(references\//.test(flattened)) {
		errors.push('flattened Skill must not depend on external reference files');
	}

	for (const heading of ['Responsibilities', 'Trigger Conditions', 'Golden Workflow', 'Recall Policy', 'Closeout', 'Instruction Isolation', 'Review Boundary', 'Skill Packaging Requirements', 'Contract Synchronization']) {
		requirePattern(contract, new RegExp(`^## ${heading}$`, 'm'), `workflow contract is missing heading: ${heading}`, errors);
	}
	requirePattern(skill, /^---\nname: tracekeeper\ndescription: [^\n]+\n---\n/, 'Skill frontmatter must contain only compatible name and description fields', errors);
	requirePattern(skill, /description: .*project continuity.*Do not use Tracekeeper/i, 'Skill description must contain positive and negative triggers', errors);
	checkWorkflowSemantics(contract, skill, flattened, errors);
	const closeoutFields = contents.get('skills/tracekeeper/references/closeout-fields.md') ?? '';
	for (const [content, owner] of [
		[contract, 'contract'],
		[closeoutFields, 'closeout guidance'],
		[flattened, 'flattened Skill'],
	]) {
		requirePattern(content, /\brelated_wiki\b/, `${owner} does not preserve related_wiki at closeout`, errors);
		requirePattern(content, /\brelated_sources\b/, `${owner} does not preserve related_sources at closeout`, errors);
		requirePattern(
			content,
			/(?:Recall results?|correlated note read)[\s\S]{0,240}(?:never invent|never[\s\S]{0,80}(?:invent|guess))/i,
			`${owner} does not constrain closeout graph paths to recalled or read evidence`,
			errors,
		);
	}

	const manifestText = contents.get(`skills/tracekeeper/${TRACEKEEPER_SKILL_MANIFEST_PATH}`) ?? '';
	let manifest;
	try {
		manifest = JSON.parse(manifestText);
	} catch {
		errors.push('Tracekeeper Skill manifest is not valid JSON');
	}
	if (manifest) checkManifestShape(manifest, errors);

	try {
		const built = await buildTracekeeperSkillBundle(repoRoot);
		if (manifestText !== built.manifestText) errors.push('Tracekeeper Skill manifest hashes or metadata are stale');
		if (flattened !== built.flattened) errors.push('Tracekeeper flattened compatibility artifact is stale');
	} catch (error) {
		errors.push(`could not rebuild Tracekeeper Skill bundle: ${error instanceof Error ? error.message : String(error)}`);
	}

	try {
		const skillRoot = path.join(repoRoot, 'skills', 'tracekeeper');
		const listed = await listSkillFiles(skillRoot);
		const allowedFiles = new Set([
			...TRACEKEEPER_SKILL_SOURCE_FILES,
			TRACEKEEPER_SKILL_MANIFEST_PATH,
			TRACEKEEPER_SKILL_FLATTENED_PATH,
		]);
		for (const file of listed) {
			if (file.symlink) errors.push(`symlink is not allowed in the Skill bundle: ${file.path}`);
			if (!allowedFiles.has(file.path)) errors.push(`untracked file in the Skill bundle: ${file.path}`);
		}
	} catch (error) {
		errors.push(`could not enumerate Tracekeeper Skill bundle: ${error instanceof Error ? error.message : String(error)}`);
	}

	const safetyContents = [
		{ relativePath: contractPath, content: contract },
		{ relativePath: skillPath, content: skill },
		...TRACEKEEPER_SKILL_SOURCE_FILES
			.filter((relativePath) => relativePath !== 'SKILL.md')
			.map((relativePath) => ({
				relativePath: `skills/tracekeeper/${relativePath}`,
				content: '',
			})),
	];
	for (const item of safetyContents) {
		if (item.content || !item.relativePath.startsWith('skills/tracekeeper/')) continue;
		item.content = await readRequired(repoRoot, item.relativePath, errors);
	}
	checkUnsafeExamples(safetyContents, errors);

	for (const indexPath of ['docs/product/INDEX.md', 'docs/architecture/INDEX.md']) {
		requirePattern(
			contents.get(indexPath) ?? '',
			/AGENT_WORKFLOW_CONTRACT\.md/,
			`${indexPath} must link to the Agent Workflow Contract`,
			errors,
		);
	}

	const settingsSource = contents.get('apps/obsidian-plugin/src/features/settings/tracekeeper-setting-tab.ts') ?? '';
	const onboardingSource = contents.get('apps/obsidian-plugin/src/features/onboarding/onboarding-state.ts') ?? '';
	const bundleSource = contents.get('apps/obsidian-plugin/src/features/skill-installation/skill-bundle.ts') ?? '';
	const auditSource = contents.get('apps/obsidian-plugin/src/features/skill-installation/skill-install-audit.ts') ?? '';
	const adapterSource = contents.get('apps/obsidian-plugin/src/adapters/client-skill-adapter.ts') ?? '';
	const buildSource = contents.get('apps/obsidian-plugin/scripts/build.mjs') ?? '';
	for (const [pattern, label] of [
		[/['"]references\/workflow-state-machine\.md['"]\s*:/, 'plugin bundle does not embed the workflow state machine'],
		[/['"]references\/failure-recovery\.md['"]\s*:/, 'plugin bundle does not embed failure recovery guidance'],
		[/['"]references\/closeout-fields\.md['"]\s*:/, 'plugin bundle does not embed closeout field guidance'],
		[/['"]references\/instruction-isolation\.md['"]\s*:/, 'plugin bundle does not embed instruction isolation guidance'],
		[/dist\/tracekeeper\.flattened\.md/, 'plugin bundle does not embed the flattened compatibility artifact'],
		[/manifest\.json/, 'plugin bundle does not embed the Skill manifest'],
		[/hashSkillFileContent/, 'plugin bundle does not verify embedded file hashes'],
		[/bundle_hash/, 'plugin bundle does not verify its bundle hash'],
	]) {
		requirePattern(bundleSource, pattern, label, errors);
	}
	for (const state of ['not_installed', 'installed', 'update_available', 'modified', 'unavailable']) {
		requirePattern(adapterSource, new RegExp(`['"]${state}['"]`), `managed Skill adapter is missing state: ${state}`, errors);
	}
	for (const pattern of [/planTtlMs/, /originalHashes/, /tracekeeper-backup-/, /Automatic overwrite is disabled/]) {
		requirePattern(adapterSource, pattern, `managed Skill adapter is missing safety control: ${pattern.source}`, errors);
	}
	for (const evidence of ['skillCopiedAt', 'skillUserConfirmedAt', 'skillFileVerifiedAt', 'agentRestartCompletedAt', 'connectionVerifiedAt', 'firstRecallCompletedAt', 'trackedWorkflowObservedAt']) {
		requirePattern(onboardingSource, new RegExp(`\\b${evidence}\\b`), `onboarding evidence is missing field: ${evidence}`, errors);
	}
	for (const label of ['Bundle available', 'Copied', 'User confirmed', 'File verified', 'Client reloaded', 'Connection verified', 'Recall observed', 'Tracked workflow observed', 'Update available']) {
		requirePattern(settingsSource, new RegExp(label), `settings does not expose Skill evidence: ${label}`, errors);
	}
	for (const field of ['action', 'client_id', 'bundle_hash', 'backup_created', 'result', 'timestamp']) {
		requirePattern(auditSource, new RegExp(`\\b${field}\\b`), `Skill install audit is missing field: ${field}`, errors);
	}
	for (const forbidden of ['targetDirectory', 'backupDirectory', 'token']) {
		if (new RegExp(`\\b${forbidden}\\b`).test(auditSource)) {
			errors.push(`Skill install audit must not record sensitive field: ${forbidden}`);
		}
	}
	requirePattern(buildSource, /build_tracekeeper_skill\.mjs/, 'plugin build does not validate the canonical Skill bundle', errors);

	return { ok: errors.length === 0, errors, warnings };
}

async function main() {
	const args = process.argv.slice(2);
	const rootIndex = args.indexOf('--root');
	const repoRoot = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : process.cwd();
	if (rootIndex >= 0 && !args[rootIndex + 1]) throw new Error('--root requires a path');
	const result = await checkAgentEcosystem(repoRoot);
	for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
	if (!result.ok) {
		for (const error of result.errors) console.error(`ERROR: ${error}`);
		process.exitCode = 1;
		return;
	}
	console.log('Agent ecosystem checks passed.');
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
