#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-graph-health-controller-'));
const output = path.join(tempRoot, 'graph-health-controller.cjs');
const require = createRequire(import.meta.url);

try {
	await build({
		entryPoints: [path.resolve('src/features/graph/graph-health-controller.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
		plugins: [{
			name: 'obsidian-stub',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
					path: 'obsidian-stub',
					namespace: 'obsidian-stub',
				}));
				buildContext.onLoad({ filter: /^obsidian-stub$/, namespace: 'obsidian-stub' }, () => ({
					loader: 'js',
					contents: "export function getLanguage() { return 'en'; }",
				}));
			},
		}],
	});

	const { GraphHealthController } = require(output);
	const calls = [];
	let refreshCount = 0;
	const host = {
		async executeLocalTool(name, args) {
			calls.push({ name, args });
			if (name === 'tracekeeper.propose_memory') {
				return { ok: true, path: '00_tracekeeper/inbox/review_queue/graph.md' };
			}
			return {
				ok: true,
				read_only: true,
				profile: 'balanced',
				vault_root: '/vault',
				scanned_at: '2026-08-07T00:00:00.000Z',
				graph_health: {
					disabled: false,
					profile: 'balanced',
					note_count: 12,
					wikilink_edge_count: 18,
					resolved_edge_count: 17,
					unresolved_edge_count: 1,
					largest_component_node_count: 10,
					component_count: 2,
					isolated_nodes: ['orphan.md'],
					isolated_node_count: 1,
					only_inbound_nodes: [],
					only_inbound_node_count: 0,
					only_outbound_nodes: [],
					only_outbound_node_count: 0,
					hub_candidates: [],
					hub_candidate_count: 0,
					missing_recommended_entry: '',
					missing_recommended_hubs: ['01_knowledge/memory/global/index.md'],
					missing_recommended_hub_count: 1,
					recommendations: ['Create the missing global memory hub.'],
					recommendation_count: 1,
					profile_issues: [],
				},
			};
		},
		async refreshGovernanceViews() {
			refreshCount += 1;
		},
		getVaultRoot() {
			return '/vault';
		},
		getGraphProfile() {
			return 'balanced';
		},
	};

	const controller = new GraphHealthController(host);
	const snapshot = await controller.loadGraphHealthSnapshot();
	assert.equal(calls[0].name, 'tracekeeper.lint');
	assert.deepEqual(calls[0].args, { max_items: 20, graph_profile: 'balanced' });
	assert.equal(snapshot.noteCount, 12);
	assert.equal(snapshot.unresolvedEdgeCount, 1);
	assert.deepEqual(snapshot.missingRecommendedHubs, ['01_knowledge/memory/global/index.md']);
	assert.equal(snapshot.profileIssues.length > 0, true);

	const proposalPath = await controller.createGraphHealthReviewProposal(snapshot);
	assert.equal(proposalPath, '00_tracekeeper/inbox/review_queue/graph.md');
	assert.equal(calls[1].name, 'tracekeeper.propose_memory');
	assert.match(calls[1].args.evidence, /^tracekeeper\.lint /);
	assert.equal(refreshCount, 1);

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 10 })}\n`);
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
