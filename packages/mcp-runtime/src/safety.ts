import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureInsideVaultRoot, isSafeDirectoryName, resolveVaultRoot, VaultPathError } from '@tracekeeper/core';

const TEXT_LIKE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text']);
const MARKDOWN_EXTENSIONS = new Set(['.md']);

export interface VaultPathSafetyOptions {
	vaultConfigDir?: string;
}

export class ToolInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ToolInputError';
	}
}

type RelativePath = string;

function toSafeText(value: unknown, field: string): string {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) {
		throw new ToolInputError(`${field} is required and must be a non-empty string.`);
	}
	return text;
}

function toPosix(value: string): string {
	return value.replace(/\\/g, '/').trim();
}

function relativePosixFromVaultRoot(vaultRoot: string, absolutePath: string): RelativePath {
	const rawRelative = path.relative(vaultRoot, absolutePath);
	if (
		rawRelative === '..' ||
		rawRelative.startsWith(`..${path.sep}`) ||
		rawRelative.startsWith('../') ||
		path.isAbsolute(rawRelative)
	) {
		throw new VaultPathError('Path is outside vault root.');
	}
	return toPosix(rawRelative);
}

export function toSafeVaultRoot(vaultRoot?: unknown): string {
	const safeVaultRoot = toSafeText(vaultRoot, 'vaultRoot');
	return resolveVaultRoot(safeVaultRoot);
}

function normalizeConfigDir(configDir?: string): string {
	const normalizedInput = toPosix(configDir || '');
	if (!normalizedInput || path.posix.isAbsolute(normalizedInput)) {
		return '';
	}
	const normalized = path.posix.normalize(normalizedInput).replace(/\/+$/g, '');
	if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
		return '';
	}
	return normalized;
}

function isVaultConfigPath(relativePath: string, options: VaultPathSafetyOptions = {}): boolean {
	const configDir = normalizeConfigDir(options.vaultConfigDir);
	return Boolean(configDir && (relativePath === configDir || relativePath.startsWith(`${configDir}/`)));
}

function assertNotVaultConfigPath(relativePath: string, action: 'Reading' | 'Writing', options: VaultPathSafetyOptions = {}): void {
	if (isVaultConfigPath(relativePath.replace(/\\/g, '/'), options)) {
		throw new VaultPathError(`${action} Obsidian configuration paths are not allowed.`);
	}
}

export function normalizeNotePath(rawPath: string, options: VaultPathSafetyOptions = {}): string {
	const safeRawPath = toSafeText(rawPath, 'path');

	const normalizedInput = toPosix(safeRawPath);
	if (path.posix.isAbsolute(normalizedInput)) {
		throw new ToolInputError('Absolute paths are not allowed. Use vault-relative paths.');
	}
	if (normalizedInput === '' || normalizedInput === '.' || normalizedInput === '..' || normalizedInput.startsWith('..' + '/')) {
		throw new ToolInputError('Path traversal is not allowed.');
	}

	const normalized = path.posix.normalize(normalizedInput);
	if (normalized === '' || normalized.startsWith('..') || normalized.includes('/../')) {
		throw new ToolInputError('Path traversal is not allowed.');
	}
	assertNotVaultConfigPath(normalized, 'Reading', options);

	const segments = normalized.split('/');
	for (const segment of segments) {
		if (segment === '') {
			continue;
		}
		if (!isSafeDirectoryName(segment, { allowHidden: true })) {
			throw new ToolInputError(`Path contains unsafe segment: ${segment}`);
		}
	}

	return normalized;
}

function hasTextLikeExtension(candidate: string): boolean {
	const ext = path.extname(candidate).toLowerCase();
	return TEXT_LIKE_EXTENSIONS.has(ext);
}

function hasMarkdownExtension(candidate: string): boolean {
	const ext = path.extname(candidate).toLowerCase();
	return MARKDOWN_EXTENSIONS.has(ext);
}

function resolveCandidatePath(vaultRoot: string, candidate: string): string {
	const absoluteCandidate = path.resolve(vaultRoot, candidate);
	return ensureInsideVaultRoot(vaultRoot, absoluteCandidate);
}

export function assertNoSymlinkSegments(vaultRoot: string, absolutePath: string): void {
	const relative = relativePosixFromVaultRoot(vaultRoot, absolutePath);
	const segments = relative.split('/').filter(Boolean);
	let cursor = vaultRoot;

	for (const segment of segments) {
		cursor = path.join(cursor, segment);
		if (!fs.existsSync(cursor)) {
			continue;
		}
		const stat = fs.lstatSync(cursor);
		if (stat.isSymbolicLink()) {
			throw new VaultPathError('Symlink paths are not allowed for note reads.');
		}
	}
}

export function resolveSafeNotePath(vaultRoot: string, rawPath: string, options: VaultPathSafetyOptions = {}): string {
	const candidate = normalizeNotePath(rawPath, options);

	const candidatePaths = hasTextLikeExtension(candidate)
		? [candidate]
		: [candidate, `${candidate}.md`, `${candidate}.markdown`, `${candidate}.txt`, `${candidate}.text`];

	for (const candidatePath of candidatePaths) {
		const absolute = resolveCandidatePath(vaultRoot, candidatePath);
		assertNotVaultConfigPath(relativeFromAbsolute(vaultRoot, absolute), 'Reading', options);

		if (!hasTextLikeExtension(absolute)) {
			continue;
		}

		if (!fs.existsSync(absolute)) {
			continue;
		}

		assertNoSymlinkSegments(vaultRoot, absolute);
		const stat = fs.lstatSync(absolute);
		if (!stat.isFile()) {
			throw new ToolInputError(`Path is not a file: ${candidatePath}`);
		}

		return absolute;
	}

	throw new VaultPathError('Note not found or not a markdown/text-like file inside vault.');
}

export interface WritablePathResolution {
	absolutePath: string;
	relativePath: string;
}

export function resolveSafeWritableNotePath(
	vaultRoot: string,
	rawPath: string,
	allowedDirectory: string,
	options: VaultPathSafetyOptions = {}
): WritablePathResolution {
	const candidate = normalizeNotePath(rawPath, options);
	const withMarkdown = hasMarkdownExtension(candidate) ? candidate : `${candidate}.md`;
	const absolute = path.resolve(vaultRoot, withMarkdown);
	const resolved = ensureInsideVaultRoot(vaultRoot, absolute);
	const relative = relativePosixFromVaultRoot(vaultRoot, resolved);

	if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new VaultPathError('Path is outside vault root.');
	}

	const normalizedAllowed = path.posix.normalize(allowedDirectory.replace(/\\/g, '/')).replace(/\/+$/g, '');
	if (!normalizedAllowed || normalizedAllowed.includes('..')) {
		throw new ToolInputError('Allowed directory prefix is invalid.');
	}

	const allowedPrefix = `${normalizedAllowed}/`;
	if (!relative.startsWith(allowedPrefix)) {
		throw new ToolInputError(`Path must be under ${normalizedAllowed}`);
	}
	if (!hasMarkdownExtension(relative)) {
		throw new ToolInputError('Only markdown (.md) files can be written.');
	}
	assertNotVaultConfigPath(relative, 'Writing', options);

	assertNoSymlinkSegments(vaultRoot, resolved);

	if (fs.existsSync(resolved)) {
		throw new ToolInputError('Target file already exists and cannot be overwritten.');
	}

	return {
		absolutePath: resolved,
		relativePath: relative,
	};
}

export function relativeFromAbsolute(vaultRoot: string, absolutePath: string): string {
	return relativePosixFromVaultRoot(vaultRoot, absolutePath);
}
