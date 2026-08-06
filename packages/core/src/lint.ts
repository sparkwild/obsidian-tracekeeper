import path from 'node:path';
import {
	DEFAULT_GRAPH_PROFILE,
	evaluateGraphProfile,
	normalizeGraphProfile,
	type GraphHealthReport,
	type GraphProfileIssue,
} from './graph-health';
import {
	ARCHITECTURE_PROJECT_DIRS,
	ARCHITECTURE_DIRS,
	REQUIRED_ARCHITECTURE_ENTRIES,
	YAML_RELATION_KEYS,
	isInLegacyDirectory,
	isKnowledgeMemoryPath,
	isKnowledgeProjectPath,
	isKnowledgeWikiPath,
	KNW_RELATED_MEMORY_KEYS,
	KNW_RELATED_WIKI_KEYS,
	GRAPH_RECOMMENDED_ENTRY,
	KNOWLEDGE_ROOT as KNOWLEDGE_ARCHITECTURE_DIR,
	resolvePreferredKnowledgePath,
	normalizeKnowledgePath as normalizeVaultPath,
} from './knowledge-architecture';
import { resolveNormalizedVaultEdges } from './knowledge-note';
import { ScannedNote } from './scan';
import {
	buildLifecycleDoctorReport,
	type LifecycleDiagnosticKind,
	type LifecycleDiagnosticOptions,
	type LifecycleDoctorReport,
} from './lifecycle-diagnostics';

export type LintIssueKind =
	| 'broken_wikilink'
	| 'claim_missing_source'
	| 'architecture_legacy_directory'
	| 'architecture_missing_required_path'
	| 'architecture_invalid_memory_path'
	| 'architecture_invalid_wiki_path'
	| 'graph_missing_memory_wiki_bridge'
	| 'graph_missing_wiki_memory_backlink'
	| 'graph_missing_project_index'
	| 'graph_yaml_only_relation'
	| 'write_policy_unstable_target'
	| LifecycleDiagnosticKind
	| GraphProfileIssue['kind'];

export interface LintIssue {
	severity: 'error' | 'warning';
	kind: LintIssueKind;
	path: string;
	line: number;
	message: string;
	context?: string;
	paths?: string[];
}

export interface LintReport {
	issues: LintIssue[];
	doctor: Omit<LifecycleDoctorReport, 'issues'>;
}

export interface LintOptions extends LifecycleDiagnosticOptions {
	graphHealth?: GraphHealthReport;
	graphProfile?: unknown;
}

const EXTERNAL_LINK = /^(?:https?:\/\/|mailto:|file:|ftp:)/i;

type RelationSource = 'yaml' | 'wikilink';

interface RelationEdge {
	source: string;
	target: string;
	line: number;
	sourceType: 'memory' | 'wiki';
	relationSource: RelationSource;
}

interface PathIndex {
	noteByLowerPath: Map<string, string>;
	noteNoExtByLowerPath: Map<string, string>;
	basenameToLowerPaths: Map<string, string[]>;
}

function readListLikeFrontmatter(note: ScannedNote, keys: readonly string[]): string[] {
	const values: string[] = [];
	for (const key of keys) {
		const value = note.frontmatter[key];
		if (typeof value === 'string') {
			if (value.trim()) {
				values.push(value.trim());
			}
			continue;
		}

		if (Array.isArray(value)) {
			for (const item of value) {
				if (typeof item === 'string' && item.trim()) {
					values.push(item.trim());
				}
			}
		}
	}

	return [...new Set(values)];
}

function buildRelationCandidate(raw: string, sourcePath: string): string {
	const bracketMatch = raw.match(/^\[\[(.*?)\]\]$/);
	let candidate = (bracketMatch ? bracketMatch[1] : raw).split('|', 2)[0].trim();
	candidate = candidate.split('#', 2)[0].trim();
	if (!candidate) {
		return '';
	}

	candidate = candidate.replace(/\\/g, '/').trim();
	if (candidate.startsWith('./') || candidate.startsWith('../')) {
		candidate = path.posix.join(path.posix.dirname(sourcePath), candidate);
	}
	candidate = candidate.replace(/^\/+/g, '').replace(/\/+/g, '/');
	candidate = path.posix.normalize(candidate);
	if (!candidate || candidate === '.') {
		return '';
	}

	if (!path.posix.extname(candidate)) {
		candidate = `${candidate}.md`;
	}

	return normalizeVaultPath(candidate);
}

function normalizeWikilinkOrPlainRelation(raw: string): string {
	const bracketMatch = raw.match(/^\[\[(.*?)\]\]$/);
	return (bracketMatch ? bracketMatch[1] : raw).split('|', 2)[0].trim();
}

function readPathIndex(notes: ScannedNote[]): PathIndex {
	const noteByLowerPath = new Map<string, string>();
	const noteNoExtByLowerPath = new Map<string, string>();
	const basenameToLowerPaths = new Map<string, string[]>();

	for (const note of notes) {
		const normalized = normalizeVaultPath(note.relativePath);
		if (!normalized) {
			continue;
		}
		const lower = normalized.toLowerCase();
		noteByLowerPath.set(lower, normalized);
		noteNoExtByLowerPath.set(stripKnownExtension(lower), normalized);

		const basename = path.posix.basename(stripKnownExtension(lower));
		const current = basenameToLowerPaths.get(basename) || [];
		if (!current.includes(lower)) {
			current.push(lower);
			basenameToLowerPaths.set(basename, current);
		}
	}

	return { noteByLowerPath, noteNoExtByLowerPath, basenameToLowerPaths };
}

function isPathLikeRelation(raw: string): boolean {
	return raw.includes('/') || raw.includes('\\') || raw.includes('.md') || raw.includes('.markdown');
}

function hasBodyWikilinkReference(note: ScannedNote, ref: string, sourcePath: string, paths: PathIndex): boolean {
	const resolvedRef = resolveReference(ref, sourcePath, paths) || buildRelationCandidate(ref, sourcePath);
	if (!resolvedRef) {
		return false;
	}
	const normalizedRef = normalizeVaultPath(stripKnownExtension(resolvedRef.toLowerCase()));
	return note.wikilinks.some((link) => {
		if (link.source !== 'body') {
			return false;
		}
		const resolvedLink = resolveReference(link.target, sourcePath, paths) || buildRelationCandidate(link.target, sourcePath);
		if (!resolvedLink) {
			return false;
		}
		return normalizeVaultPath(stripKnownExtension(resolvedLink.toLowerCase())) === normalizedRef;
	});
}

function resolveReference(
	raw: string,
	sourcePath: string,
	paths: PathIndex
): string | null {
	const candidate = buildRelationCandidate(raw, sourcePath);
	if (!candidate) {
		return null;
	}
	const candidateLower = candidate.toLowerCase();
	if (paths.noteByLowerPath.has(candidateLower)) {
		return paths.noteByLowerPath.get(candidateLower) || null;
	}

	const candidateNoExt = stripKnownExtension(candidateLower);
	if (paths.noteNoExtByLowerPath.has(candidateNoExt)) {
		return paths.noteNoExtByLowerPath.get(candidateNoExt) || null;
	}

	const alias = path.posix.basename(candidateNoExt);
	const aliases = paths.basenameToLowerPaths.get(alias);
	if (aliases && aliases.length === 1) {
		return aliases[0] || null;
	}

	return null;
}

function getSourceType(note: ScannedNote): { isMemory: boolean; isWiki: boolean } {
	const normalizedPath = normalizeVaultPath(note.relativePath);
	const type = typeof note.type === 'string' ? note.type.toLowerCase() : '';
	return {
		isMemory: isKnowledgeMemoryPath(normalizedPath) || type === 'memory',
		isWiki: isKnowledgeWikiPath(normalizedPath) || type === 'wiki',
	};
}

function addRelationEdge(
	sourceToTargets: Map<string, Set<string>>,
	relationSource: RelationSource,
	source: string,
	target: string,
	line: number,
	sourceType: 'memory' | 'wiki',
	edges: RelationEdge[]
): void {
	let targets = sourceToTargets.get(source);
	if (!targets) {
		targets = new Set<string>();
		sourceToTargets.set(source, targets);
	}
	targets.add(target);
	edges.push({
		source,
		target,
		line,
		sourceType,
		relationSource,
	});
}

function collectProjectIndexIssues(notes: ScannedNote[]): LintIssue[] {
	const projectHasNotes = new Map<string, { hasIndex: boolean; hasAnyNote: boolean }>();

	for (const note of notes) {
		const normalized = normalizeVaultPath(note.relativePath);
		if (!normalized || !isKnowledgeProjectPath(normalized)) {
			continue;
		}

		for (const projectDir of ARCHITECTURE_PROJECT_DIRS) {
			if (!normalized.startsWith(`${projectDir}/`)) {
				continue;
			}

			const suffix = normalized.slice(projectDir.length + 1);
			const projectSegment = suffix.split('/', 1)[0];
			if (!projectSegment) {
				continue;
			}

			const projectRoot = `${projectDir}/${projectSegment}`;
			const state = projectHasNotes.get(projectRoot) || { hasIndex: false, hasAnyNote: false };

			if (normalized === `${projectRoot}/index.md`) {
				state.hasIndex = true;
			} else if (!normalized.endsWith('/index.md')) {
				state.hasAnyNote = true;
			}
			projectHasNotes.set(projectRoot, state);
		}
	}

	const issues: LintIssue[] = [];
	for (const [projectRoot, state] of projectHasNotes.entries()) {
		if (state.hasAnyNote && !state.hasIndex) {
			issues.push({
				severity: 'warning',
				kind: 'graph_missing_project_index',
				path: `${projectRoot}/index.md`,
				line: 1,
				message: `Missing required project index note: ${projectRoot}/index.md`,
				paths: [projectRoot],
			});
		}
	}

	return issues;
}

function getRequiredEntries(notePathSet: Set<string>): string[] {
	const requiredEntries: string[] = [];
	for (const candidate of REQUIRED_ARCHITECTURE_ENTRIES) {
		const resolvedPath = resolvePreferredKnowledgePath(notePathSet, candidate);
		if (!resolvedPath) {
			requiredEntries.push(normalizeVaultPath(candidate.path));
		}
	}
	return requiredEntries;
}

export function lintNotes(vaultRoot: string, notes: ScannedNote[], options: LintOptions = {}): LintReport {
	const issues: LintIssue[] = [];
	const graphProfile = normalizeGraphProfile(options.graphProfile);
	const strictStructureSeverity = graphProfile === 'strict' ? 'error' : 'warning';
	const graphStructureEnabled = graphProfile !== 'off';
	const resolvedEdges = resolveNormalizedVaultEdges(
		notes.map((note) => ({
			path: note.relativePath,
			title: note.title,
			aliases: note.aliases,
			edges: note.edges,
		}))
	);

	const pathIndex = readPathIndex(notes);
	const notePathSet = new Set(notes.map((note) => normalizeVaultPath(note.relativePath)).filter(Boolean));
	const memoryToWikiYamlEdges: RelationEdge[] = [];
	const memoryToWikiLinkEdges: RelationEdge[] = [];
	const wikiToMemoryYamlEdges: RelationEdge[] = [];
	const wikiToMemoryLinkEdges: RelationEdge[] = [];
	const memoryToWikiYamlBySource = new Map<string, Set<string>>();
	const memoryToWikiLinkBySource = new Map<string, Set<string>>();
	const wikiToMemoryYamlBySource = new Map<string, Set<string>>();
	const wikiToMemoryLinkBySource = new Map<string, Set<string>>();

	for (const originalNote of notes) {
		const normalizedPath = normalizeVaultPath(originalNote.relativePath);
		if (!normalizedPath) {
			continue;
		}
		const semanticEdges = [...(resolvedEdges.get(normalizedPath) ?? originalNote.edges)];
		const note: ScannedNote = {
			...originalNote,
			edges: semanticEdges,
			wikilinks: semanticEdges,
		};

		const sourceKinds = getSourceType(note);
		if (isInLegacyDirectory(normalizedPath)) {
			issues.push({
				severity: 'warning',
				kind: 'architecture_legacy_directory',
				path: note.relativePath,
				line: 1,
				message: `Legacy directory detected: ${normalizedPath}. Prefer ${ARCHITECTURE_DIRS.join(', ')} layout.`,
			});
		}

		for (const link of note.wikilinks) {
			if (link.source === 'frontmatter' || EXTERNAL_LINK.test(link.target) || link.target.includes('|')) {
				continue;
			}

			if (link.resolution.status !== 'resolved') {
				const unresolvedTarget = link.target || link.referenceLabel || link.raw;
				issues.push({
					severity: link.resolution.reason === 'unsafe_path' ? 'warning' : 'error',
					kind: 'broken_wikilink',
					path: note.relativePath,
					line: link.line,
					message: `Broken wikilink target: ${unresolvedTarget}`,
					context: link.raw,
				});
				continue;
			}

			const targetRelative = normalizeVaultPath(link.resolution.path);
			if (sourceKinds.isMemory && isKnowledgeWikiPath(targetRelative)) {
				addRelationEdge(
					memoryToWikiLinkBySource,
					'wikilink',
					normalizedPath,
					targetRelative,
					link.line,
					'memory',
					memoryToWikiLinkEdges
				);
			} else if (sourceKinds.isWiki && isKnowledgeMemoryPath(targetRelative)) {
				addRelationEdge(
					wikiToMemoryLinkBySource,
					'wikilink',
					normalizedPath,
					targetRelative,
					link.line,
					'wiki',
					wikiToMemoryLinkEdges
				);
			}
		}

		for (const claim of note.claimBlocks) {
			if (claim.sourceRefs.length === 0) {
				issues.push({
					severity: 'warning',
					kind: 'claim_missing_source',
					path: note.relativePath,
					line: claim.line,
					message: 'Claim block has no source references',
					context: claim.rawHeader,
				});
			}
		}

		const relatedWikis = readListLikeFrontmatter(note, KNW_RELATED_WIKI_KEYS);
		if (sourceKinds.isMemory && relatedWikis.length > 0) {
			for (const ref of relatedWikis) {
				const relationCandidate = buildRelationCandidate(ref, normalizedPath);
				if (isPathLikeRelation(ref) && relationCandidate && !isKnowledgeWikiPath(relationCandidate)) {
					issues.push({
						severity: strictStructureSeverity,
						kind: 'architecture_invalid_wiki_path',
						path: note.relativePath,
						line: 1,
						message: `Invalid wiki relation path for memory note: ${ref}`,
						context: ref,
					});
				}

				const resolved = resolveReference(ref, normalizedPath, pathIndex);
				if (!resolved) {
					continue;
				}
				const resolvedByFrontmatter = normalizeVaultPath(resolved);
				if (!isKnowledgeWikiPath(resolvedByFrontmatter)) {
					issues.push({
						severity: strictStructureSeverity,
						kind: 'architecture_invalid_wiki_path',
						path: note.relativePath,
						line: 1,
						message: `Invalid wiki relation path for memory note: ${ref}`,
						context: ref,
					});
					continue;
				}

				addRelationEdge(
					memoryToWikiYamlBySource,
					'yaml',
					normalizedPath,
					resolvedByFrontmatter,
					1,
					'memory',
					memoryToWikiYamlEdges
				);
			}
		}

		const relatedMemories = readListLikeFrontmatter(note, KNW_RELATED_MEMORY_KEYS);
		if (sourceKinds.isWiki && relatedMemories.length > 0) {
			for (const ref of relatedMemories) {
				const relationCandidate = buildRelationCandidate(ref, normalizedPath);
				if (isPathLikeRelation(ref) && relationCandidate && !isKnowledgeMemoryPath(relationCandidate)) {
					issues.push({
						severity: strictStructureSeverity,
						kind: 'architecture_invalid_memory_path',
						path: note.relativePath,
						line: 1,
						message: `Invalid memory relation path for wiki note: ${ref}`,
						context: ref,
					});
				}

				const resolved = resolveReference(ref, normalizedPath, pathIndex);
				if (!resolved) {
					continue;
				}
				const resolvedByFrontmatter = normalizeVaultPath(resolved);
				if (!isKnowledgeMemoryPath(resolvedByFrontmatter)) {
					issues.push({
						severity: strictStructureSeverity,
						kind: 'architecture_invalid_memory_path',
						path: note.relativePath,
						line: 1,
						message: `Invalid memory relation path for wiki note: ${ref}`,
						context: ref,
					});
					continue;
				}

				addRelationEdge(
					wikiToMemoryYamlBySource,
					'yaml',
					normalizedPath,
					resolvedByFrontmatter,
					1,
					'wiki',
					wikiToMemoryYamlEdges
				);
			}
		}

		for (const ref of readListLikeFrontmatter(note, YAML_RELATION_KEYS)) {
			const normalizedRef = normalizeWikilinkOrPlainRelation(ref);
			if (!normalizedRef || EXTERNAL_LINK.test(normalizedRef)) {
				continue;
			}
			if (!isPathLikeRelation(normalizedRef) && !resolveReference(normalizedRef, normalizedPath, pathIndex)) {
				continue;
			}
			if (graphStructureEnabled && !hasBodyWikilinkReference(note, normalizedRef, normalizedPath, pathIndex)) {
				issues.push({
					severity: 'warning',
					kind: 'graph_yaml_only_relation',
					path: note.relativePath,
					line: 1,
					message: `YAML relation should also be represented as a body wikilink: ${normalizedRef}`,
					context: normalizedRef,
				});
			}
		}
	}

	for (const [source, targets] of memoryToWikiYamlBySource.entries()) {
		const wikiTargets = targets;
		for (const target of wikiTargets) {
			if (graphStructureEnabled && !memoryToWikiLinkBySource.get(source)?.has(target)) {
				issues.push({
					severity: strictStructureSeverity,
					kind: 'graph_missing_memory_wiki_bridge',
					path: source,
					line: 1,
					message: `Memory note requires wikilink bridge to wiki note: ${target}`,
					context: target,
					paths: [target],
				});
			}
		}
	}

	for (const [source, targets] of memoryToWikiLinkBySource.entries()) {
		const wikiTargets = targets;
		for (const target of wikiTargets) {
			if (graphStructureEnabled && !memoryToWikiYamlBySource.get(source)?.has(target)) {
				issues.push({
					severity: 'warning',
					kind: 'graph_yaml_only_relation',
					path: source,
					line: 1,
					message: `Wikilink to wiki should have related_wiki relation in YAML: ${target}`,
					context: target,
					paths: [target],
				});
			}
		}
	}

	for (const [memorySource, wikiTargets] of memoryToWikiYamlBySource.entries()) {
		for (const wikiTarget of wikiTargets) {
			const hasBacklink =
				wikiToMemoryYamlBySource.get(wikiTarget)?.has(memorySource) ||
				wikiToMemoryLinkBySource.get(wikiTarget)?.has(memorySource);
			if (graphStructureEnabled && !hasBacklink) {
				issues.push({
					severity: 'warning',
					kind: 'graph_missing_wiki_memory_backlink',
					path: wikiTarget,
					line: 1,
					message: `Wiki note ${wikiTarget} has no backlink to memory note ${memorySource}`,
					context: memorySource,
					paths: [memorySource],
				});
			}
		}
	}

	if (graphStructureEnabled) {
		issues.push(...collectProjectIndexIssues(notes));
	}

	const requiredEntries = getRequiredEntries(notePathSet);
	for (const entryPath of requiredEntries) {
		issues.push({
			severity: strictStructureSeverity,
			kind: 'architecture_missing_required_path',
			path: entryPath,
			line: 1,
			message: `Required architecture entry note is missing: ${entryPath}`,
		});
	}

	if (options.graphHealth) {
		issues.push(...buildGraphProfileLintIssues(options.graphHealth, options.graphProfile));
	}

	const lifecycleDoctor = buildLifecycleDoctorReport(notes, options);
	issues.push(...lifecycleDoctor.issues);

	return {
		issues,
		doctor: {
			directory_counts: lifecycleDoctor.directory_counts,
			legacy_candidates: lifecycleDoctor.legacy_candidates,
		},
	};
}

function buildGraphProfileLintIssues(report: GraphHealthReport, profile: unknown): LintIssue[] {
	const evaluation = evaluateGraphProfile(report, profile ?? DEFAULT_GRAPH_PROFILE);
	if (evaluation.disabled) {
		return [];
	}

	const issues: LintIssue[] = [];
	for (const profileIssue of evaluation.profile_issues) {
		if (profileIssue.kind === 'graph_unresolved_wikilink') {
			for (const edge of report.unresolved_edges) {
				issues.push({
					severity: profileIssue.severity,
					kind: profileIssue.kind,
					path: edge.path,
					line: edge.line,
					message: `Unresolved graph wikilink target: ${edge.target}`,
					context: edge.context,
				});
			}
			continue;
		}

		const paths =
			profileIssue.paths && profileIssue.paths.length > 0
				? profileIssue.paths
				: [GRAPH_RECOMMENDED_ENTRY];
		for (const issuePath of paths) {
			issues.push({
				severity: profileIssue.severity,
				kind: profileIssue.kind,
				path: issuePath,
				line: 1,
				message: profileIssue.message,
				paths: profileIssue.paths,
			});
		}
	}
	return issues;
}

function stripKnownExtension(value: string): string {
	const extension = path.posix.extname(value).toLowerCase();
	if (extension === '.md' || extension === '.markdown') {
		return value.slice(0, -extension.length);
	}
	return value;
}
