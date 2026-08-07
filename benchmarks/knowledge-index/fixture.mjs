import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	allocateFixtureDimensions,
	canonicalJson,
	resolveFixtureConfig,
	seededRandom,
	sha256,
	shuffled,
} from './config.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const FIXED_TIME_BASE_MS = Date.parse('2026-01-01T00:00:00.000Z');
const EVENT_TIME_BASE_MS = Date.parse('2027-01-01T00:00:00.000Z');

function yamlString(value) {
	return JSON.stringify(String(value));
}

function yamlList(values) {
	return `[${values.map((value) => yamlString(value)).join(', ')}]`;
}

function fixedTime(index, baseMs = FIXED_TIME_BASE_MS) {
	return new Date(baseMs + index * 1_000).toISOString();
}

function fileVersion(size, modifiedAt) {
	return `${modifiedAt}|${size}`;
}

async function writeDurable(filePath, content) {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const handle = await fs.open(filePath, 'w');
	try {
		await handle.writeFile(content, 'utf8');
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function paddedContent(lines, targetBytes, token) {
	let content = `${lines.join('\n')}\n`;
	let counter = 0;
	while (Buffer.byteLength(content, 'utf8') < targetBytes) {
		const remaining = targetBytes - Buffer.byteLength(content, 'utf8');
		const chunk = `fixture-padding-${token}-${String(counter).padStart(4, '0')} `;
		if (Buffer.byteLength(chunk, 'utf8') <= remaining) {
			content += chunk;
		} else {
			content += 'x'.repeat(remaining);
		}
		counter += 1;
	}
	return content;
}

function noteRelativePath(root, type, projectHint, index) {
	const filename = `note-${String(index + 1).padStart(6, '0')}.md`;
	if (type === 'project-memory') {
		return `${root}/${projectHint}/${filename}`;
	}
	return `${root}/fixture/${filename}`;
}

function ensureRootTypeAtIndex(rootDefinitions, roots, targetIndex, requiredType) {
	const requiredIndex = rootDefinitions.findIndex((root, index) =>
		index !== targetIndex && root.type === requiredType
	);
	if (requiredIndex < 0) {
		throw new Error(`Fixture allocation is missing required root type: ${requiredType}`);
	}
	[rootDefinitions[targetIndex], rootDefinitions[requiredIndex]] = [
		rootDefinitions[requiredIndex],
		rootDefinitions[targetIndex],
	];
	const expected = roots.find((root) => root.type === requiredType);
	if (!expected || rootDefinitions[targetIndex].type !== requiredType) {
		throw new Error(`Unable to place required fixture root type: ${requiredType}`);
	}
}

function eventContent(eventId, revision) {
	return [
		'---',
		`type: ${yamlString('wiki-concept')}`,
		`fixture_event: ${yamlString(eventId)}`,
		`fixture_revision: ${yamlString(revision)}`,
		'---',
		`# Event ${eventId}`,
		'',
		`eventfixture ${eventId} revision ${revision}`,
		'',
	].join('\n');
}

function eventPayload(eventId, revision, timeIndex) {
	const content = eventContent(eventId, revision);
	const modifiedAt = fixedTime(timeIndex, EVENT_TIME_BASE_MS);
	const size = Buffer.byteLength(content, 'utf8');
	return {
		content,
		content_sha256: sha256(content),
		modified_at: modifiedAt,
		size,
		file_version: fileVersion(size, modifiedAt),
	};
}

function buildIncrementalEvents(config, notes) {
	const events = [];
	let sequence = 1;
	const mutableNotes = notes.filter((note) =>
		note.query_classes.length === 1 &&
		note.query_classes[0] === 'global_fanout'
	);
	if (config.events.modify + config.events.delete + config.events.rename > mutableNotes.length) {
		throw new Error('Incremental event cohorts would overwrite fixed Recall query anchors.');
	}

	for (let index = 0; index < config.events.create; index += 1) {
		const id = `create-${String(index + 1).padStart(4, '0')}`;
		const after = eventPayload(id, 'created', sequence);
		events.push({
			sequence: sequence++,
			kind: 'create',
			path: `01_knowledge/wiki/events/${id}.md`,
			before_file_version: null,
			after_file_version: after.file_version,
			content_id: `${id}:created`,
			content_sha256: after.content_sha256,
			modified_at: after.modified_at,
			expected_generation_delta: 1,
			expected_final_path: `01_knowledge/wiki/events/${id}.md`,
		});
	}

	let noteOffset = 0;
	for (let index = 0; index < config.events.modify; index += 1) {
		const note = mutableNotes[noteOffset + index];
		const id = `modify-${String(index + 1).padStart(4, '0')}`;
		const after = eventPayload(id, 'modified', sequence);
		events.push({
			sequence: sequence++,
			kind: 'modify',
			path: note.relative_path,
			before_file_version: note.file_version,
			after_file_version: after.file_version,
			content_id: `${id}:modified`,
			content_sha256: after.content_sha256,
			modified_at: after.modified_at,
			expected_generation_delta: 1,
			expected_final_path: note.relative_path,
		});
	}
	noteOffset += config.events.modify;

	for (let index = 0; index < config.events.delete; index += 1) {
		const note = mutableNotes[noteOffset + index];
		events.push({
			sequence: sequence++,
			kind: 'delete',
			path: note.relative_path,
			before_file_version: note.file_version,
			after_file_version: null,
			content_id: null,
			content_sha256: null,
			modified_at: note.modified_at,
			expected_generation_delta: 1,
			expected_final_path: null,
		});
	}
	noteOffset += config.events.delete;

	for (let index = 0; index < config.events.rename; index += 1) {
		const note = mutableNotes[noteOffset + index];
		const basename = path.posix.basename(note.relative_path);
		const targetPath = `01_knowledge/wiki/renamed/${basename}`;
		events.push({
			sequence: sequence++,
			kind: 'rename',
			path: note.relative_path,
			new_path: targetPath,
			before_file_version: note.file_version,
			after_file_version: note.file_version,
			content_id: note.content_id,
			content_sha256: note.content_sha256,
			modified_at: note.modified_at,
			expected_generation_delta: 1,
			expected_final_path: targetPath,
		});
	}

	return {
		schema: 'tracekeeper-index-events/v1',
		kind: 'incremental',
		events,
	};
}

function buildReplayEvents() {
	const events = [];
	let sequence = 1;
	const paths = [];
	const createdEvents = [];
	const modifiedEvents = [];
	const renamedEvents = [];

	for (let index = 0; index < 20; index += 1) {
		const id = `replay-${String(index + 1).padStart(3, '0')}`;
		const created = eventPayload(id, 'created', sequence);
		const eventPath = `01_knowledge/wiki/replay/${id}.md`;
		paths.push(eventPath);
		const event = {
			sequence: sequence++,
			kind: 'create',
			path: eventPath,
			before_file_version: null,
			after_file_version: created.file_version,
			content_id: `${id}:created`,
			content_sha256: created.content_sha256,
			modified_at: created.modified_at,
			expected_generation_delta: 1,
			expected_final_path: eventPath,
		};
		events.push(event);
		createdEvents.push(event);
	}
	events.push({
		...createdEvents[0],
		sequence: sequence++,
		case: 'duplicate_create',
		expected_generation_delta: 0,
	});

	for (let index = 0; index < 20; index += 1) {
		const id = `replay-${String(index + 1).padStart(3, '0')}`;
		const modified = eventPayload(id, 'modified', sequence);
		const event = {
			sequence: sequence++,
			kind: 'modify',
			path: paths[index],
			before_file_version: createdEvents[index].after_file_version,
			after_file_version: modified.file_version,
			content_id: `${id}:modified`,
			content_sha256: modified.content_sha256,
			modified_at: modified.modified_at,
			expected_generation_delta: 1,
			expected_final_path: paths[index],
		};
		events.push(event);
		modifiedEvents.push(event);
	}
	events.push({
		...modifiedEvents[0],
		sequence: sequence++,
		case: 'duplicate_modify',
		expected_generation_delta: 0,
	});

	const stale = eventPayload('replay-stale', 'stale', 0);
	events.push(
		{
			sequence: sequence++,
			kind: 'modify',
			case: 'stale_modify',
			path: paths[0],
			before_file_version: stale.file_version,
			after_file_version: stale.file_version,
			content_id: 'replay-stale:stale',
			content_sha256: stale.content_sha256,
			modified_at: stale.modified_at,
			expected_generation_delta: 0,
			expected_final_path: paths[0],
		},
		{
			sequence: sequence++,
			kind: 'delete',
			case: 'stale_delete',
			path: paths[1],
			before_file_version: createdEvents[1].after_file_version,
			after_file_version: null,
			content_id: null,
			content_sha256: null,
			modified_at: createdEvents[1].modified_at,
			expected_generation_delta: 0,
			expected_final_path: paths[1],
		},
		{
			sequence: sequence++,
			kind: 'rename',
			case: 'stale_rename',
			path: paths[2],
			new_path: '01_knowledge/wiki/replay-renamed/stale-target.md',
			before_file_version: stale.file_version,
			after_file_version: stale.file_version,
			content_id: 'replay-stale:stale',
			content_sha256: stale.content_sha256,
			modified_at: stale.modified_at,
			expected_generation_delta: 0,
			expected_final_path: paths[2],
		}
	);

	for (let index = 0; index < 20; index += 1) {
		const targetPath = `01_knowledge/wiki/replay-renamed/replay-${String(index + 1).padStart(3, '0')}.md`;
		const modifiedEvent = modifiedEvents[index];
		const event = {
			sequence: sequence++,
			kind: 'rename',
			path: paths[index],
			new_path: targetPath,
			before_file_version: modifiedEvent.after_file_version,
			after_file_version: modifiedEvent.after_file_version,
			content_id: modifiedEvent.content_id,
			content_sha256: modifiedEvent.content_sha256,
			modified_at: modifiedEvent.modified_at,
			expected_generation_delta: 1,
			expected_final_path: targetPath,
		};
		events.push(event);
		renamedEvents.push(event);
		paths[index] = targetPath;
	}
	events.push(
		{
			...renamedEvents[0],
			sequence: sequence++,
			case: 'duplicate_rename',
			expected_generation_delta: 0,
		},
		{
			...renamedEvents[1],
			sequence: sequence++,
			case: 'repeated_rename_target',
			expected_generation_delta: 0,
		}
	);

	const deletedEvents = [];
	for (let index = 0; index < 20; index += 1) {
		const renameEvent = renamedEvents[index];
		const event = {
			sequence: sequence++,
			kind: 'delete',
			path: paths[index],
			before_file_version: renameEvent.after_file_version,
			after_file_version: null,
			content_id: null,
			content_sha256: null,
			modified_at: renameEvent.modified_at,
			expected_generation_delta: 1,
			expected_final_path: null,
		};
		events.push(event);
		deletedEvents.push(event);
	}
	events.push({
		...deletedEvents[0],
		sequence: sequence++,
		case: 'duplicate_delete',
		expected_generation_delta: 0,
	});

	return {
		schema: 'tracekeeper-index-events/v1',
		kind: 'replay',
		events,
	};
}

async function generatorSourceSha() {
	const sourceFiles = ['config.mjs', 'fixture.mjs'];
	const contents = await Promise.all(
		sourceFiles.map((filename) => fs.readFile(path.join(moduleDirectory, filename), 'utf8'))
	);
	return sha256(contents.join('\u0000'));
}

export function contentForIncrementalEvent(event) {
	if (event.kind !== 'create' && event.kind !== 'modify') {
		return null;
	}
	const [eventId, revision] = event.content_id.split(':');
	return eventContent(eventId, revision);
}

export async function generateFixture(options) {
	const fixtureRoot = path.resolve(options.fixtureRoot);
	const config = resolveFixtureConfig(options);
	const dimensions = allocateFixtureDimensions(config);
	const random = seededRandom(`${config.seed}\u0000notes`);
	const allIndices = shuffled(
		Array.from({ length: config.note_count }, (_, index) => index),
		random
	);
	const isolatedCount = Math.round(config.note_count * config.graph.isolated_note_rate);
	const isolated = new Set(allIndices.slice(0, isolatedCount));
	const validTargets = allIndices.filter((index) => !isolated.has(index));
	const rootDefinitions = dimensions.rootIndexes.map((rootIndex) => config.roots[rootIndex]);
	ensureRootTypeAtIndex(rootDefinitions, config.roots, 0, 'wiki-concept');
	ensureRootTypeAtIndex(
		rootDefinitions,
		config.roots,
		config.project_group_count,
		'project-memory'
	);
	ensureRootTypeAtIndex(
		rootDefinitions,
		config.roots,
		config.project_group_count * 2,
		'agent-task'
	);
	ensureRootTypeAtIndex(
		rootDefinitions,
		config.roots,
		config.project_group_count * 3,
		'session'
	);
	const notePaths = rootDefinitions.map((root, index) => {
		const projectIndex = index % config.project_group_count;
		const projectHint = `project-${String(projectIndex + 1).padStart(3, '0')}`;
		return noteRelativePath(root.path, root.type, projectHint, index);
	});
	const sourcePaths = notePaths.filter((_, index) => rootDefinitions[index].type === 'captured-source');
	const noteRecords = [];

	await fs.mkdir(fixtureRoot, { recursive: true });
	for (let index = 0; index < config.note_count; index += 1) {
		const root = rootDefinitions[index];
		const projectIndex = index % config.project_group_count;
		const projectHint = `project-${String(projectIndex + 1).padStart(3, '0')}`;
		const projectId = `project-id-${String(projectIndex + 1).padStart(3, '0')}`;
		const taskId = `task-${String(projectIndex + 1).padStart(3, '0')}`;
		const tagCount = dimensions.tagCounts[index];
		const tags = Array.from(
			{ length: tagCount },
			(_, tagIndex) => `fixture-tag-${String((index + tagIndex) % config.tags.pool_size).padStart(2, '0')}`
		);
		const outgoingCount = isolated.has(index) ? 0 : dimensions.outgoingCounts[index];
		const validLinks = [];
		for (let linkIndex = 0; linkIndex < outgoingCount; linkIndex += 1) {
			const targetIndex = validTargets[(index * 17 + linkIndex * 31 + 1) % validTargets.length];
			if (targetIndex !== index) {
				validLinks.push(notePaths[targetIndex].replace(/\.md$/u, ''));
			}
		}
		const missingCount = outgoingCount > 0 &&
			((index + 1) / config.note_count <= config.graph.missing_link_rate)
			? 1
			: 0;
		const missingLinks = Array.from(
			{ length: missingCount },
			(_, missingIndex) => `missing/fixture-${String(index + 1).padStart(6, '0')}-${missingIndex + 1}`
		);
		const relatedSources = sourcePaths.length > 0 &&
			(index + 1) / config.note_count <= config.graph.source_relation_rate
			? [sourcePaths[index % sourcePaths.length]]
			: [];
		const queryClasses = ['global_fanout'];
		if (index === 0) queryClasses.push('global_exact');
		if (projectIndex === 0) queryClasses.push('project_exact');
		if (root.type === 'agent-task' || root.type === 'session') queryClasses.push('project_history');
		const modifiedAt = fixedTime(index);
		const frontmatter = [
			'---',
			`type: ${yamlString(root.type)}`,
			`fixture_id: ${yamlString(`note-${String(index + 1).padStart(6, '0')}`)}`,
			`project_hint: ${yamlString(projectHint)}`,
			`project_id: ${yamlString(projectId)}`,
			`repo_path: ${yamlString(`synthetic/repos/${projectHint}`)}`,
			`task_id: ${yamlString(taskId)}`,
			`tags: ${yamlList(tags)}`,
			...(relatedSources.length ? [`related_sources: ${yamlList(relatedSources)}`] : []),
			'---',
		];
		const body = [
			...frontmatter,
			`# Fixture note ${String(index + 1).padStart(6, '0')}`,
			'',
			'sharedfixture deterministic knowledge index benchmark content.',
			...(index === 0 ? ['exactfixturealpha durable exact match.'] : []),
			...(projectIndex === 0 ? ['projectfixture001 project-scoped durable context.'] : []),
			...validLinks.map((target) => `[[${target}]]`),
			...missingLinks.map((target) => `[[${target}]]`),
			'',
		];
		const content = paddedContent(body, dimensions.bodyTargets[index], String(index + 1));
		const relativePath = notePaths[index];
		const absolutePath = path.join(fixtureRoot, ...relativePath.split('/'));
		await writeDurable(absolutePath, content);
		const modifiedDate = new Date(modifiedAt);
		await fs.utimes(absolutePath, modifiedDate, modifiedDate);
		const size = Buffer.byteLength(content, 'utf8');
		noteRecords.push({
			content_id: `note-${String(index + 1).padStart(6, '0')}:base`,
			relative_path: relativePath,
			root: root.path,
			type: root.type,
			project_id: projectId,
			project_hint: projectHint,
			modified_at: modifiedAt,
			target_bytes: dimensions.bodyTargets[index],
			size,
			file_version: fileVersion(size, modifiedAt),
			content_sha256: sha256(content),
			query_classes: queryClasses,
			valid_links: [...new Set(validLinks)].sort(),
			missing_links: missingLinks,
			isolated: isolated.has(index),
		});
	}

	const incrementalEvents = buildIncrementalEvents(config, noteRecords);
	const replayEvents = buildReplayEvents();
	const generatorSha256 = await generatorSourceSha();
	const manifestWithoutHash = {
		...config,
		generator_sha256: generatorSha256,
		queries: {
			global_exact: { scope: 'global', query: 'exactfixturealpha', max_items: 6 },
			global_fanout: { scope: 'global', query: 'sharedfixture', max_items: 6 },
			global_zero: { scope: 'global', query: 'qzxvplmn0987654321', max_items: 6 },
			project_exact: {
				scope: 'project',
				query: 'projectfixture001',
				project_hint: 'project-001',
				project_id: 'project-id-001',
				repo_path: 'synthetic/repos/project-001',
				max_items: 6,
			},
			project_uncertain: {
				scope: 'project',
				query: 'sharedfixture',
				max_items: 6,
			},
			project_history: {
				scope: 'project_history',
				query: 'sharedfixture',
				project_hint: 'project-001',
				project_id: 'project-id-001',
				max_items: 6,
			},
		},
		notes: noteRecords,
		incremental_events_sha256: sha256(canonicalJson(incrementalEvents)),
		replay_events_sha256: sha256(canonicalJson(replayEvents)),
	};
	const manifest = {
		...manifestWithoutHash,
		manifest_sha256: sha256(canonicalJson(manifestWithoutHash)),
	};

	await writeDurable(path.join(fixtureRoot, 'fixture-manifest.json'), canonicalJson(manifest));
	await writeDurable(path.join(fixtureRoot, 'incremental-events.json'), canonicalJson(incrementalEvents));
	await writeDurable(path.join(fixtureRoot, 'replay-events.json'), canonicalJson(replayEvents));

	return {
		fixtureRoot,
		manifest,
		incrementalEvents,
		replayEvents,
	};
}

export async function verifyFixture(fixture) {
	const failures = [];
	for (const note of fixture.manifest.notes) {
		const absolutePath = path.join(fixture.fixtureRoot, ...note.relative_path.split('/'));
		const content = await fs.readFile(absolutePath);
		const stat = await fs.stat(absolutePath);
		if (content.length !== note.size) {
			failures.push(`${note.relative_path}: size mismatch`);
		}
		if (sha256(content) !== note.content_sha256) {
			failures.push(`${note.relative_path}: content hash mismatch`);
		}
		if (fileVersion(stat.size, stat.mtime.toISOString()) !== note.file_version) {
			failures.push(`${note.relative_path}: file version mismatch`);
		}
	}
	const manifestWithoutHash = { ...fixture.manifest };
	delete manifestWithoutHash.manifest_sha256;
	if (sha256(canonicalJson(manifestWithoutHash)) !== fixture.manifest.manifest_sha256) {
		failures.push('fixture-manifest.json: manifest hash mismatch');
	}
	return {
		ok: failures.length === 0,
		note_count: fixture.manifest.notes.length,
		failures,
	};
}

export async function cleanupFixture(fixtureRoot) {
	await fs.rm(path.resolve(fixtureRoot), { recursive: true, force: true });
}
