import { stringify } from 'yaml';
import { normalizeVaultRelativePath } from './knowledge-note';
import { KNOWLEDGE_GLOBAL_MEMORY_DIR } from './knowledge-architecture';
import type { ProjectMemoryEntry } from './project-memory';

export const MEMORY_RECORD_SCHEMA_VERSION = 2 as const;
export const MEMORY_RECORD_TYPE = 'memory_record' as const;

export type MemoryScope = 'global' | 'project';
export type MemoryAuthority = 'agent' | 'source' | 'user';
export type MemoryConfidenceLevel = 'uncertain' | 'inferred' | 'supported' | 'verified';
export type MemoryDeclaredState = 'active' | 'disputed' | 'retracted' | 'review';

export interface MemoryRecordSource {
	path: string;
	frontmatter: Readonly<Record<string, unknown>>;
	body?: string;
}

export interface MemoryRecord {
	schema_version: typeof MEMORY_RECORD_SCHEMA_VERSION;
	type: typeof MEMORY_RECORD_TYPE;
	path: string;
	memory_id: string;
	scope: MemoryScope;
	project_id: string | null;
	agent_type: string;
	operation_id: string;
	memory_kind: string;
	claim_key: string;
	authority: MemoryAuthority;
	confidence_level: MemoryConfidenceLevel;
	declared_state: MemoryDeclaredState;
	observed_at: string;
	valid_from: string | null;
	valid_to: string | null;
	last_verified_at: string | null;
	evidence: readonly string[];
	supersedes: readonly string[];
	contradicts: readonly string[];
	project_hub: string | null;
	global_hub: string | null;
	related_wiki: readonly string[];
	related_sources: readonly string[];
}

export interface BuildMemoryRecordInput extends Omit<MemoryRecord, 'schema_version' | 'type' | 'path'> {
	path: string;
	body: string;
}

export interface BuiltMemoryRecord {
	record: MemoryRecord;
	body: string;
	markdown: string;
}

export interface GlobalMemoryEntryPathInput {
	agentType: string;
	operationKind: string;
	operationId: string;
}

export type MemoryRecordReadProjection =
	| { kind: 'v2'; record: MemoryRecord; legacy: false }
	| {
			kind: 'project_v1';
			legacy: true;
			path: string;
			scope: 'project';
			project_id: string;
			operation_id: string;
			claim_key: null;
			declared_state: MemoryDeclaredState;
			observed_at: string;
	  }
	| {
			kind: 'legacy_unkeyed';
			legacy: true;
			path: string;
			scope: MemoryScope;
			project_id: string | null;
			claim_key: null;
	  };

export class MemoryRecordValidationError extends Error {
	readonly code = 'invalid_memory_record';

	constructor(message: string) {
		super(message);
		this.name = 'MemoryRecordValidationError';
	}
}

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const AGENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MEMORY_KIND_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const AUTHORITIES = new Set<MemoryAuthority>(['agent', 'source', 'user']);
const CONFIDENCE_LEVELS = new Set<MemoryConfidenceLevel>([
	'uncertain',
	'inferred',
	'supported',
	'verified',
]);
const DECLARED_STATES = new Set<MemoryDeclaredState>([
	'active',
	'disputed',
	'retracted',
	'review',
]);

export function buildGlobalMemoryEntryPath(
	input: GlobalMemoryEntryPathInput
): string {
	const agentType = requirePathIdentity(input.agentType, 'agentType', AGENT_TYPE_PATTERN);
	const operationKind = requirePathIdentity(
		input.operationKind,
		'operationKind',
		MEMORY_KIND_PATTERN
	);
	const operationId = requirePathIdentity(
		input.operationId,
		'operationId',
		OPERATION_ID_PATTERN
	);
	return normalizeVaultRelativePath(
		`${KNOWLEDGE_GLOBAL_MEMORY_DIR}/agents/${agentType}/${operationKind}-${operationId}.md`
	);
}

export function parseMemoryRecord(source: MemoryRecordSource): MemoryRecord {
	const path = normalizePath(source.path, 'path');
	const frontmatter = requireObject(source.frontmatter, 'frontmatter');
	if (frontmatter.schema_version !== MEMORY_RECORD_SCHEMA_VERSION) {
		throw new MemoryRecordValidationError(
			`memory record schema_version must be ${MEMORY_RECORD_SCHEMA_VERSION}.`
		);
	}
	if (frontmatter.type !== MEMORY_RECORD_TYPE) {
		throw new MemoryRecordValidationError(`memory record type must be ${MEMORY_RECORD_TYPE}.`);
	}

	const scope = requireEnum(frontmatter.scope, 'scope', new Set<MemoryScope>(['global', 'project']));
	const projectId = optionalPattern(frontmatter.project_id, 'project_id', PROJECT_ID_PATTERN);
	if (scope === 'project' && !projectId) {
		throw new MemoryRecordValidationError('project_id is required for project memory.');
	}
	if (scope === 'global' && projectId) {
		throw new MemoryRecordValidationError('project_id is not allowed for global memory.');
	}

	const evidence = normalizeVaultLinkList(frontmatter.evidence, 'evidence');
	const confidence = requireEnum(
		frontmatter.confidence_level,
		'confidence_level',
		CONFIDENCE_LEVELS
	);
	if (confidence === 'verified' && evidence.length === 0) {
		throw new MemoryRecordValidationError('verified memory requires at least one evidence reference.');
	}

	const validFrom = optionalTimestamp(frontmatter.valid_from, 'valid_from');
	const validTo = optionalTimestamp(frontmatter.valid_to, 'valid_to');
	if (validFrom && validTo && Date.parse(validFrom) > Date.parse(validTo)) {
		throw new MemoryRecordValidationError('valid_from must not be later than valid_to.');
	}

	const projectHub = optionalVaultLink(frontmatter.project_hub, 'project_hub');
	const globalHub = optionalVaultLink(frontmatter.global_hub, 'global_hub');
	if (scope === 'project' && !projectHub) {
		throw new MemoryRecordValidationError('project_hub is required for project memory.');
	}
	if (scope === 'global' && !globalHub) {
		throw new MemoryRecordValidationError('global_hub is required for global memory.');
	}

	return {
		schema_version: MEMORY_RECORD_SCHEMA_VERSION,
		type: MEMORY_RECORD_TYPE,
		path,
		memory_id: requirePattern(frontmatter.memory_id, 'memory_id', STABLE_ID_PATTERN),
		scope,
		project_id: projectId,
		agent_type: requirePattern(frontmatter.agent_type, 'agent_type', AGENT_TYPE_PATTERN),
		operation_id: requirePattern(frontmatter.operation_id, 'operation_id', STABLE_ID_PATTERN),
		memory_kind: requirePattern(frontmatter.memory_kind, 'memory_kind', MEMORY_KIND_PATTERN),
		claim_key: normalizeClaimKey(frontmatter.claim_key),
		authority: requireEnum(frontmatter.authority, 'authority', AUTHORITIES),
		confidence_level: confidence,
		declared_state: requireEnum(frontmatter.declared_state, 'declared_state', DECLARED_STATES),
		observed_at: requireTimestamp(frontmatter.observed_at, 'observed_at'),
		valid_from: validFrom,
		valid_to: validTo,
		last_verified_at: optionalTimestamp(frontmatter.last_verified_at, 'last_verified_at'),
		evidence,
		supersedes: normalizeStableIdList(frontmatter.supersedes, 'supersedes'),
		contradicts: normalizeStableIdList(frontmatter.contradicts, 'contradicts'),
		project_hub: projectHub,
		global_hub: globalHub,
		related_wiki: normalizeVaultLinkList(frontmatter.related_wiki, 'related_wiki'),
		related_sources: normalizeVaultLinkList(frontmatter.related_sources, 'related_sources'),
	};
}

export function buildMemoryRecord(input: BuildMemoryRecordInput): BuiltMemoryRecord {
	if (typeof input.body !== 'string') {
		throw new MemoryRecordValidationError('body must be a string.');
	}
	const body = input.body.replace(/\r\n?/g, '\n').trim();
	if (!body) {
		throw new MemoryRecordValidationError('body must not be empty.');
	}
	const record = parseMemoryRecord({
		path: input.path,
		frontmatter: {
			schema_version: MEMORY_RECORD_SCHEMA_VERSION,
			type: MEMORY_RECORD_TYPE,
			memory_id: input.memory_id,
			scope: input.scope,
			project_id: input.project_id,
			agent_type: input.agent_type,
			operation_id: input.operation_id,
			memory_kind: input.memory_kind,
			claim_key: input.claim_key,
			authority: input.authority,
			confidence_level: input.confidence_level,
			declared_state: input.declared_state,
			observed_at: input.observed_at,
			valid_from: input.valid_from,
			valid_to: input.valid_to,
			last_verified_at: input.last_verified_at,
			evidence: input.evidence,
			supersedes: input.supersedes,
			contradicts: input.contradicts,
			project_hub: input.project_hub,
			global_hub: input.global_hub,
			related_wiki: input.related_wiki,
			related_sources: input.related_sources,
		},
	});
	return { record, body, markdown: renderMemoryRecordMarkdown(record, body) };
}

export function renderMemoryRecordMarkdown(record: MemoryRecord, body: string): string {
	const normalized = parseMemoryRecord({ path: record.path, frontmatter: { ...record } });
	const normalizedBody = typeof body === 'string' ? body.replace(/\r\n?/g, '\n').trim() : '';
	if (!normalizedBody) {
		throw new MemoryRecordValidationError('body must not be empty.');
	}
	const frontmatter: Record<string, unknown> = {
		schema_version: normalized.schema_version,
		type: normalized.type,
		memory_id: normalized.memory_id,
		scope: normalized.scope,
		...(normalized.project_id ? { project_id: normalized.project_id } : {}),
		agent_type: normalized.agent_type,
		operation_id: normalized.operation_id,
		memory_kind: normalized.memory_kind,
		claim_key: normalized.claim_key,
		authority: normalized.authority,
		confidence_level: normalized.confidence_level,
		declared_state: normalized.declared_state,
		observed_at: normalized.observed_at,
		...(normalized.valid_from ? { valid_from: normalized.valid_from } : {}),
		...(normalized.valid_to ? { valid_to: normalized.valid_to } : {}),
		...(normalized.last_verified_at ? { last_verified_at: normalized.last_verified_at } : {}),
		evidence: [...normalized.evidence],
		supersedes: [...normalized.supersedes],
		contradicts: [...normalized.contradicts],
		...(normalized.project_hub ? { project_hub: normalized.project_hub } : {}),
		...(normalized.global_hub ? { global_hub: normalized.global_hub } : {}),
		related_wiki: [...normalized.related_wiki],
		related_sources: [...normalized.related_sources],
	};
	return `---\n${stringify(frontmatter).trimEnd()}\n---\n\n${normalizedBody}\n`;
}

export function projectMemoryEntryToReadProjection(entry: ProjectMemoryEntry): MemoryRecordReadProjection {
	return {
		kind: 'project_v1',
		legacy: true,
		path: normalizePath(entry.path, 'path'),
		scope: 'project',
		project_id: entry.project_id,
		operation_id: entry.operation_id,
		claim_key: null,
		declared_state: projectStatusToDeclaredState(entry.status),
		observed_at: entry.created_at,
	};
}

export function legacyMemoryToReadProjection(input: {
	path: string;
	scope?: MemoryScope;
	project_id?: string | null;
}): MemoryRecordReadProjection {
	const scope = input.scope ?? (input.project_id ? 'project' : 'global');
	const projectId = optionalPattern(input.project_id, 'project_id', PROJECT_ID_PATTERN);
	if (scope === 'project' && !projectId) {
		throw new MemoryRecordValidationError('project_id is required for a project legacy projection.');
	}
	return {
		kind: 'legacy_unkeyed',
		legacy: true,
		path: normalizePath(input.path, 'path'),
		scope,
		project_id: scope === 'project' ? projectId : null,
		claim_key: null,
	};
}

function projectStatusToDeclaredState(status: ProjectMemoryEntry['status']): MemoryDeclaredState {
	if (status === 'disputed') return 'disputed';
	if (status === 'review') return 'review';
	return 'active';
}

function requirePathIdentity(
	value: unknown,
	field: string,
	pattern: RegExp
): string {
	if (typeof value !== 'string' || !pattern.test(value)) {
		throw new MemoryRecordValidationError(`${field} is invalid.`);
	}
	return value;
}

function normalizeClaimKey(value: unknown): string {
	if (typeof value !== 'string') {
		throw new MemoryRecordValidationError('claim_key must be a string.');
	}
	const canonical = value.normalize('NFC');
	if (hasControlCharacter(canonical)) {
		throw new MemoryRecordValidationError('claim_key is empty, too long, or contains control characters.');
	}
	const normalized = canonical.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
	if (!normalized || normalized.length > 240) {
		throw new MemoryRecordValidationError('claim_key is empty, too long, or contains control characters.');
	}
	return normalized;
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) {
			return true;
		}
	}
	return false;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new MemoryRecordValidationError(`${field} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function requirePattern(value: unknown, field: string, pattern: RegExp): string {
	if (typeof value !== 'string' || !pattern.test(value.trim())) {
		throw new MemoryRecordValidationError(`${field} is invalid.`);
	}
	return value.trim();
}

function optionalPattern(value: unknown, field: string, pattern: RegExp): string | null {
	if (value === undefined || value === null || value === '') return null;
	return requirePattern(value, field, pattern);
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: ReadonlySet<T>): T {
	if (typeof value !== 'string' || !allowed.has(value as T)) {
		throw new MemoryRecordValidationError(`${field} is invalid.`);
	}
	return value as T;
}

function requireTimestamp(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) {
		throw new MemoryRecordValidationError(`${field} must be a valid timestamp.`);
	}
	return new Date(value).toISOString();
}

function optionalTimestamp(value: unknown, field: string): string | null {
	if (value === undefined || value === null || value === '') return null;
	return requireTimestamp(value, field);
}

function normalizeStableIdList(value: unknown, field: string): string[] {
	return normalizeList(value, field, (item) => requirePattern(item, field, STABLE_ID_PATTERN));
}

function normalizeVaultLinkList(value: unknown, field: string): string[] {
	return normalizeList(value, field, (item) => normalizeVaultLink(item, field));
}

function normalizeList(value: unknown, field: string, normalize: (item: unknown) => string): string[] {
	if (value === undefined || value === null || value === '') return [];
	const values = Array.isArray(value) ? value : [value];
	const result: string[] = [];
	const seen = new Set<string>();
	for (const item of values) {
		const normalized = normalize(item);
		if (!seen.has(normalized)) {
			seen.add(normalized);
			result.push(normalized);
		}
	}
	return result;
}

function optionalVaultLink(value: unknown, field: string): string | null {
	if (value === undefined || value === null || value === '') return null;
	return normalizeVaultLink(value, field);
}

function normalizeVaultLink(value: unknown, field: string): string {
	if (typeof value !== 'string') {
		throw new MemoryRecordValidationError(`${field} must contain Vault-relative references.`);
	}
	const raw = value.trim();
	const wikilink = raw.match(/^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/u);
	const path = normalizePath(wikilink ? wikilink[1] : raw, field).replace(/\.md$/iu, '');
	return `[[${path}]]`;
}

function normalizePath(value: unknown, field: string): string {
	if (typeof value !== 'string') {
		throw new MemoryRecordValidationError(`${field} must be a Vault-relative path.`);
	}
	try {
		return normalizeVaultRelativePath(value.trim());
	} catch (error) {
		throw new MemoryRecordValidationError(
			`${field} is invalid: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}
