export type ParsedRecordValue = string | string[];

export interface ParsedRecord {
	[key: string]: ParsedRecordValue;
}

export interface ParsedFrontmatter {
	fields: ParsedRecord;
	body: string;
}

const MAX_TASK_SNIPPET_LENGTH = 160;

export function readFrontmatter(content: string): ParsedFrontmatter {
		const normalized = content.replace(/\r\n/g, '\n');
		const lines = normalized.split('\n');
		if (lines.length === 0 || lines[0].trim() !== '---') {
			return { fields: {}, body: normalized };
		}

		const fields: ParsedRecord = {};
		let cursor = 1;
		for (; cursor < lines.length; cursor++) {
			const line = lines[cursor];
			if (line.trim() === '---') {
				cursor += 1;
				break;
			}

			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) {
				continue;
			}

			const pair = trimmed.match(/^([^:]+):\s*(.*)$/);
			if (!pair) {
				continue;
			}

			const key = pair[1].trim();
			const rawValue = pair[2].trim();
			if (rawValue === '') {
				const values: string[] = [];
				let next = cursor + 1;
				while (next < lines.length) {
					const match = lines[next].match(/^\s*-\s+(.*)$/);
					if (!match) {
						break;
					}
					values.push(match[1].trim());
					next += 1;
				}
				if (values.length > 0) {
					fields[key] = values;
					cursor = next - 1;
				}
				continue;
			}

			fields[key] = parseScalarOrArray(rawValue);
		}

		return { fields, body: lines.slice(cursor).join('\n') };
	}

export function parseScalarOrArray(value: string): ParsedRecordValue {
		const trimmed = value.trim();
		if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
			const inner = trimmed.slice(1, -1).trim();
			if (!inner) {
				return [];
			}
			return inner
				.split(',')
				.map((item) => trimText(item.replace(/^['"]|['"]$/g, '')))
				.filter(Boolean);
		}

		if (
			(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
			(trimmed.startsWith("'") && trimmed.endsWith("'"))
		) {
			return trimmed.slice(1, -1);
		}

		return trimmed;
	}

export function readRevisionComment(values: ParsedRecord): string {
		return readMultilineString(values, ['revision_comment', 'revisionComment']);
	}

export function readMultilineString(values: ParsedRecord, keys: string[]): string {
		for (const key of keys) {
			const value = values[key];
			if (Array.isArray(value)) {
				const joined = value.join('\n').trim();
				if (joined) {
					return joined;
				}
				continue;
			}
			if (typeof value === 'string' && value.trim()) {
				return value.replace(/\\n/g, '\n').trim();
			}
		}
		return '';
	}

export function normalizeFrontmatterRevisionComment(comment: string): string[] {
		const normalized = comment.replace(/\r\n/g, '\n').trim();
		if (!normalized) {
			return [];
		}
		return normalized.split('\n').map((line) => line.trimEnd());
	}

export function escapeAuditValue(value: string): string {
		return value
			.replace(/[\r\n]+/g, '\\n')
			.replace(/"/g, '\\"')
			.trim();
	}

export function readKeyValueRows(lines: string[]): ParsedRecord {
		const rows: ParsedRecord = {};
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const normalized = trimmed.replace(/^-\s+/, '');
			const match = normalized.match(/^([^:]+):\s*(.*)$/);
			if (!match) {
				continue;
			}
			const key = match[1].trim();
			const rawValue = match[2].trim();
			if (rawValue) {
				rows[key] = parseScalarOrArray(rawValue);
				continue;
			}

			const listValues: string[] = [];
			for (let listIndex = index + 1; listIndex < lines.length; listIndex += 1) {
				const listMatch = lines[listIndex].match(/^\s+-\s+(.*)$/);
				if (!listMatch) {
					break;
				}
				const value = parseScalarOrArray(listMatch[1].trim());
				if (typeof value === 'string' && value) {
					listValues.push(value);
				} else if (Array.isArray(value)) {
					listValues.push(...value);
				}
				index = listIndex;
			}
			rows[key] = listValues;
		}
		return rows;
	}

export function firstString(values: ParsedRecord, keys: string[]): string {
		for (const key of keys) {
			const value = values[key];
			if (typeof value === 'string' && value.trim()) {
				return value.trim();
			}
			if (Array.isArray(value)) {
				const first = value.find((entry) => Boolean(entry && entry.trim()));
				if (first) {
					return first;
				}
			}
		}
		return '';
	}

export function readStringList(values: ParsedRecord, keys: string[]): string[] {
		const items: string[] = [];
		for (const key of keys) {
			const value = values[key];
			if (!value) continue;
			if (Array.isArray(value)) {
				items.push(...value.filter(Boolean));
				continue;
			}
			items.push(
				...value
					.split(',')
					.map((entry) => entry.trim())
					.filter(Boolean)
			);
		}
		return [...new Set(items)];
	}

export function parseTimestamp(timestamp: string | undefined, fallbackMs?: number): number {
		if (timestamp) {
			const parsed = Date.parse(timestamp);
			if (!Number.isNaN(parsed)) {
				return parsed;
			}
		}
		if (fallbackMs) {
			return fallbackMs;
		}
		return 0;
	}

export function timestampFromFilename(name: string): string {
		const match = name.match(/\d{4}[-_]?\d{2}[-_]?\d{2}([T_]\d{2}[-_]?\d{2}[-_]?\d{2})?/);
		if (!match) return '';
		return match[0].replace(/_/g, 'T').replace(/-/g, '-');
	}

export function snippetFromText(text: string, fallback: string = ''): string {
		const lines = text
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.filter((line) => !line.startsWith('#'))
			.filter((line) => !line.startsWith('---'));

		const raw =
			lines.length > 0 ? lines[0] : trimText(fallback, MAX_TASK_SNIPPET_LENGTH);
		return trimText(raw, MAX_TASK_SNIPPET_LENGTH);
	}

export function trimText(value: string, maxLength = MAX_TASK_SNIPPET_LENGTH): string {
		const trimmed = value.trim();
		if (trimmed.length <= maxLength) {
			return trimmed;
		}
		return `${trimmed.slice(0, maxLength - 1)}…`;
	}
