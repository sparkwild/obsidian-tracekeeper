import crypto from 'node:crypto';

export const FIXTURE_SCHEMA = 'tracekeeper-index-fixture/v1';
export const REPORT_SCHEMA = 'tracekeeper-index-benchmark/v1';
export const GENERATOR_VERSION = '1';
export const DEFAULT_SEED = 'tracekeeper-index-v1';

export const TIER_NOTE_COUNTS = Object.freeze({
	tiny: 40,
	'1k': 1_000,
	'5k': 5_000,
	'20k': 20_000,
});

export const DEFAULT_BODY_BYTES = Object.freeze([
	{ weight: 60, target: 512 },
	{ weight: 30, target: 2_048 },
	{ weight: 10, target: 8_192 },
]);

export const DEFAULT_ROOTS = Object.freeze([
	{ weight: 45, path: '01_knowledge/wiki', type: 'wiki-concept' },
	{ weight: 20, path: '01_knowledge/memory/projects', type: 'project-memory' },
	{ weight: 20, path: '01_knowledge/sources', type: 'captured-source' },
	{ weight: 8, path: '00_tracekeeper/work/tasks', type: 'agent-task' },
	{ weight: 7, path: '00_tracekeeper/work/sessions', type: 'session' },
]);

export const DEFAULT_TAGS = Object.freeze({
	pool_size: 64,
	per_note: Object.freeze([
		{ weight: 20, count: 0 },
		{ weight: 50, count: 1 },
		{ weight: 25, count: 2 },
		{ weight: 5, count: 4 },
	]),
});

export const DEFAULT_GRAPH = Object.freeze({
	valid_outgoing_per_note: Object.freeze([
		{ weight: 20, count: 0 },
		{ weight: 45, count: 1 },
		{ weight: 25, count: 3 },
		{ weight: 10, count: 8 },
	]),
	missing_link_rate: 0.05,
	isolated_note_rate: 0.10,
	source_relation_rate: 0.15,
});

export const DEFAULT_EVENT_COUNTS = Object.freeze({
	create: 100,
	modify: 100,
	delete: 100,
	rename: 100,
});

export function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

export function canonicalize(value) {
	if (Array.isArray(value)) {
		return value.map((entry) => canonicalize(entry));
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonicalize(value[key])])
		);
	}
	return value;
}

export function canonicalJson(value) {
	return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function largestRemainder(total, weightedEntries) {
	if (!Number.isInteger(total) || total < 0) {
		throw new Error('Allocation total must be a non-negative integer.');
	}
	const weightTotal = weightedEntries.reduce((sum, entry) => sum + entry.weight, 0);
	if (!(weightTotal > 0)) {
		throw new Error('Allocation weights must have a positive sum.');
	}
	const rows = weightedEntries.map((entry, index) => {
		const exact = (total * entry.weight) / weightTotal;
		return {
			index,
			count: Math.floor(exact),
			remainder: exact - Math.floor(exact),
		};
	});
	let remaining = total - rows.reduce((sum, row) => sum + row.count, 0);
	for (const row of [...rows].sort((left, right) =>
		right.remainder - left.remainder || left.index - right.index
	)) {
		if (remaining === 0) {
			break;
		}
		row.count += 1;
		remaining -= 1;
	}
	return rows.sort((left, right) => left.index - right.index).map((row) => row.count);
}

export function seededRandom(seed) {
	const digest = crypto.createHash('sha256').update(String(seed)).digest();
	let state = digest.readUInt32BE(0);
	return () => {
		state = (state + 0x6D2B79F5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

export function shuffled(values, random) {
	const result = [...values];
	for (let index = result.length - 1; index > 0; index -= 1) {
		const selected = Math.floor(random() * (index + 1));
		[result[index], result[selected]] = [result[selected], result[index]];
	}
	return result;
}

function allocatedValues(total, weightedEntries, valueKey, random) {
	const counts = largestRemainder(total, weightedEntries);
	const values = [];
	for (let index = 0; index < weightedEntries.length; index += 1) {
		for (let count = 0; count < counts[index]; count += 1) {
			values.push(weightedEntries[index][valueKey]);
		}
	}
	return shuffled(values, random);
}

function cloneWeighted(entries) {
	return entries.map((entry) => ({ ...entry }));
}

export function resolveFixtureConfig(options = {}) {
	const tier = options.tier ?? 'tiny';
	const noteCount = TIER_NOTE_COUNTS[tier];
	if (!noteCount) {
		throw new Error(`Unknown benchmark tier: ${tier}`);
	}
	const seed = String(options.seed ?? DEFAULT_SEED);
	const defaultEventCount = tier === 'tiny'
		? Math.max(1, Math.min(4, Math.floor(noteCount / 3)))
		: DEFAULT_EVENT_COUNTS.create;
	const requestedEvents = options.eventCounts ?? {};
	const events = Object.fromEntries(
		Object.keys(DEFAULT_EVENT_COUNTS).map((kind) => [
			kind,
			requestedEvents[kind] ?? defaultEventCount,
		])
	);
	for (const [kind, count] of Object.entries(events)) {
		if (!Number.isInteger(count) || count < 1) {
			throw new Error(`Event count for ${kind} must be a positive integer.`);
		}
	}
	if (events.modify + events.delete + events.rename > noteCount) {
		throw new Error('Modify, delete, and rename event cohorts must fit inside the base fixture.');
	}

	return {
		schema: FIXTURE_SCHEMA,
		seed,
		tier,
		note_count: noteCount,
		generator_version: GENERATOR_VERSION,
		body_bytes: cloneWeighted(DEFAULT_BODY_BYTES),
		roots: cloneWeighted(DEFAULT_ROOTS),
		tags: {
			pool_size: DEFAULT_TAGS.pool_size,
			per_note: cloneWeighted(DEFAULT_TAGS.per_note),
		},
		graph: {
			valid_outgoing_per_note: cloneWeighted(DEFAULT_GRAPH.valid_outgoing_per_note),
			missing_link_rate: DEFAULT_GRAPH.missing_link_rate,
			isolated_note_rate: DEFAULT_GRAPH.isolated_note_rate,
			source_relation_rate: DEFAULT_GRAPH.source_relation_rate,
		},
		project_group_count: Math.max(8, Math.floor(noteCount / 250)),
		events,
	};
}

export function allocateFixtureDimensions(config) {
	const random = seededRandom(`${config.seed}\u0000${config.tier}`);
	return {
		bodyTargets: allocatedValues(config.note_count, config.body_bytes, 'target', random),
		rootIndexes: allocatedValues(
			config.note_count,
			config.roots.map((entry, index) => ({ ...entry, index })),
			'index',
			random
		),
		tagCounts: allocatedValues(config.note_count, config.tags.per_note, 'count', random),
		outgoingCounts: allocatedValues(
			config.note_count,
			config.graph.valid_outgoing_per_note,
			'count',
			random
		),
	};
}
