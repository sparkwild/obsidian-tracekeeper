import { canonicalJson, sha256 } from './config.mjs';

function sorted(values) {
	return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

function normalizedMap(input, normalizeValue = (value) => value) {
	return [...input.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => [key, normalizeValue(value)]);
}

function normalizeWikilink(link) {
	return {
		raw: link.raw,
		target: link.target,
		alias: link.alias ?? null,
		heading: link.heading ?? null,
		line: link.line,
	};
}

function normalizeNote(note) {
	return {
		path: note.path,
		file_version: note.fileVersion,
		title: note.title,
		aliases: sorted(note.aliases),
		type: note.type,
		tags: sorted(note.tags),
		frontmatter: note.frontmatter,
		headings: [...note.headings],
		block_ids: sorted(note.blockIds),
		wikilinks: note.wikilinks
			.map((link) => normalizeWikilink(link))
			.sort((left, right) =>
				left.target.localeCompare(right.target) ||
				left.line - right.line ||
				left.raw.localeCompare(right.raw)
			),
		backlinks: sorted(note.backlinks),
		search_tokens: sorted(note.searchTokens),
		excerpt_source: note.excerptSource,
		content_hash: note.contentHash,
		size: note.size,
	};
}

export function normalizeSnapshotContent(snapshot) {
	return {
		version: snapshot.version,
		notes: normalizedMap(snapshot.notes, (note) => normalizeNote(note)),
		graph: {
			outgoing: normalizedMap(snapshot.graph.outgoing, (paths) => sorted(paths)),
			incoming: normalizedMap(snapshot.graph.incoming, (paths) => sorted(paths)),
		},
		scopes: {
			by_type: normalizedMap(snapshot.scopes.byType, (paths) => sorted(paths)),
			by_tag: normalizedMap(snapshot.scopes.byTag, (paths) => sorted(paths)),
		},
	};
}

export function normalizeSnapshotState(snapshot) {
	return {
		index_state: snapshot.index_state,
		generation: snapshot.generation,
		last_event: snapshot.last_event
			? {
				kind: snapshot.last_event.kind,
				path: snapshot.last_event.path,
				new_path: snapshot.last_event.kind === 'rename'
					? snapshot.last_event.newPath
					: null,
				file_version: snapshot.last_event.fileVersion,
			}
			: null,
	};
}

export function snapshotDigests(snapshot) {
	const content = normalizeSnapshotContent(snapshot);
	const state = normalizeSnapshotState(snapshot);
	return {
		content,
		state,
		content_sha256: sha256(canonicalJson(content)),
		state_sha256: sha256(canonicalJson({ content, state })),
	};
}

export function snapshotCounts(snapshot) {
	const outgoingEdges = [...snapshot.graph.outgoing.values()]
		.reduce((sum, paths) => sum + paths.length, 0);
	const incomingEdges = [...snapshot.graph.incoming.values()]
		.reduce((sum, paths) => sum + paths.length, 0);
	return {
		note_count: snapshot.notes.size,
		outgoing_edge_count: outgoingEdges,
		incoming_edge_count: incomingEdges,
		type_scope_count: snapshot.scopes.byType.size,
		tag_scope_count: snapshot.scopes.byTag.size,
	};
}

export function nearestRank(values, percentile) {
	if (values.length === 0) {
		return null;
	}
	const ordered = [...values].sort((left, right) => left - right);
	const rank = Math.max(1, Math.ceil(percentile * ordered.length));
	return ordered[rank - 1];
}

export function summarizeNanoseconds(values) {
	const samples = values.filter((value) => Number.isInteger(value) && value >= 0);
	if (samples.length === 0) {
		return {
			count: 0,
			min_ns: null,
			p50_ns: null,
			p95_ns: null,
			max_ns: null,
			mean_ns: null,
		};
	}
	const total = samples.reduce((sum, value) => sum + value, 0);
	return {
		count: samples.length,
		min_ns: Math.min(...samples),
		p50_ns: nearestRank(samples, 0.5),
		p95_ns: nearestRank(samples, 0.95),
		max_ns: Math.max(...samples),
		mean_ns: Math.round(total / samples.length),
	};
}
