#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracekeeper-graph-health-controller-'));
const output = path.join(tempRoot, 'graph-health-controller.cjs');
const viewOutput = path.join(tempRoot, 'graph-health-view.cjs');
const viewSource = fs.readFileSync('src/features/graph/graph-health-view.ts', 'utf8');
const require = createRequire(import.meta.url);

const obsidianStub = {
	name: 'obsidian-stub',
	setup(buildContext) {
		buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
			path: 'obsidian-stub',
			namespace: 'obsidian-stub',
		}));
		buildContext.onLoad({ filter: /^obsidian-stub$/, namespace: 'obsidian-stub' }, () => ({
			loader: 'js',
			contents: `
				export function getLanguage() { return globalThis.__tracekeeperGraphTestLanguage || 'en'; }
				export class ItemView { constructor(leaf) { this.leaf = leaf; } }
				export class Notice {
					constructor(message) {
						globalThis.__tracekeeperGraphTestNotices = [
							...(globalThis.__tracekeeperGraphTestNotices || []),
							message,
						];
					}
				}
			`,
		}));
	},
};

class FakeElement {
	constructor(tag = 'div', options = {}) {
		this.tag = tag;
		this.text = options.text || '';
		this.children = [];
	}

	empty() {
		this.children = [];
	}

	addClass() {}

	createDiv(options = {}) {
		return this.createEl('div', options);
	}

	createEl(tag, options = {}) {
		const child = new FakeElement(tag, options);
		this.children.push(child);
		return child;
	}

	addEventListener() {}

	setText(text) {
		this.text = text;
	}
}

const collectText = (element, skipTag = '') => {
	if (element.tag === skipTag) return '';
	return [element.text, ...element.children.map((child) => collectText(child, skipTag))]
		.filter(Boolean)
		.join(' ');
};

try {
	await build({
		entryPoints: [path.resolve('src/features/graph/graph-health-controller.ts')],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
		plugins: [obsidianStub],
	});
	await build({
		entryPoints: [path.resolve('src/features/graph/graph-health-view.ts')],
		outfile: viewOutput,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
		plugins: [obsidianStub],
	});

	const { GraphHealthController } = require(output);
	const calls = [];
	const host = {
		async executeLocalTool(name, args) {
			calls.push({ name, args });
			return {
				ok: true,
				read_only: true,
				profile: 'advisory',
				vault_root: '/vault',
				scanned_at: '2026-08-07T00:00:00.000Z',
				graph_health: {
					disabled: false,
					profile: 'advisory',
					note_count: 12,
				edge_observation_count: 20,
				ignored_edge_observation_count: 5,
				ignored_unresolved_edge_count: 4,
				wikilink_edge_count: 18,
					resolved_edge_count: 17,
					unresolved_edge_count: 0,
					largest_component_node_count: 10,
					component_count: 2,
					maintenance_component_count: 1,
					isolated_nodes: ['01_knowledge/sources/files/unassociated.md'],
					isolated_node_count: 1,
					actionable_isolated_nodes: [],
					actionable_isolated_node_count: 0,
					only_inbound_nodes: ['01_knowledge/sources/files/leaf.md'],
					only_inbound_node_count: 1,
					only_outbound_nodes: ['01_knowledge/wiki/index.md'],
					only_outbound_node_count: 1,
					hub_candidates: [],
					hub_candidate_count: 0,
					missing_recommended_entry: '',
					missing_recommended_hubs: ['01_knowledge/memory/global/index.md'],
					missing_recommended_hub_count: 1,
					recommendations: [],
					recommendation_count: 0,
					profile_issues: [],
				},
				maintenance: {
					candidates: [],
				},
			};
		},
		getVaultRoot() {
			return '/vault';
		},
		getGraphProfile() {
		return 'advisory';
		},
	};

	const controller = new GraphHealthController(host);
	const snapshot = await controller.loadGraphHealthSnapshot();
	assert.equal(calls[0].name, 'tracekeeper.lint');
	assert.deepEqual(calls[0].args, { max_items: 20, graph_profile: 'advisory' });
	assert.equal(snapshot.noteCount, 12);
	assert.equal(snapshot.edgeObservationCount, 20);
	assert.equal(snapshot.ignoredEdgeObservationCount, 5);
	assert.equal(snapshot.ignoredUnresolvedEdgeCount, 4);
	assert.equal(snapshot.unresolvedEdgeCount, 0);
	assert.deepEqual(snapshot.missingRecommendedHubs, ['01_knowledge/memory/global/index.md']);
	assert.equal(snapshot.profileIssues.length, 0);
	assert.equal(snapshot.recommendationCount, 0);
	assert.equal(snapshot.componentCount, 2);
	assert.equal(snapshot.maintenanceComponentCount, 1);
	assert.equal(snapshot.isolatedNodeCount, 1);
	assert.equal(snapshot.actionableIsolatedNodeCount, 0);
	assert.equal(snapshot.onlyInboundNodeCount, 1);
	assert.equal(snapshot.onlyOutboundNodeCount, 1);
	assert.equal(snapshot.maintenanceCandidates.length, 0);
	assert.equal(calls.some((call) => call.name === 'tracekeeper.propose_memory'), false);

	const { TracekeeperGraphHealthView } = require(viewOutput);
	const view = new TracekeeperGraphHealthView({}, {});
	globalThis.__tracekeeperGraphTestLanguage = 'zh-CN';
	assert.equal(view.graphIssueSeverityLabel('error'), '错误');
	assert.equal(view.graphIssueKindLabel('graph_missing_hub'), '缺失推荐中心节点');
	assert.equal(view.graphIssueKindLabel('future_graph_issue'), '图谱问题');
	assert.equal(view.graphIssueMessage({
		kind: 'future_graph_issue',
		severity: 'warning',
		message: 'Future raw graph diagnostic.',
		count: 2,
		paths: [],
	}), '图谱检查返回了 2 个需要关注的问题。');
	assert.equal(view.graphIssueCount({
		kind: 'unresolved_wikilinks',
		severity: 'warning',
		message: '1 wikilink is unresolved.',
		count: 1,
		paths: [],
	}, {
		unresolvedEdgeCount: 7,
	}), 7);

	globalThis.__tracekeeperGraphTestLanguage = 'en';
	assert.equal(view.graphIssueKindLabel('graph_disconnected'), 'Disconnected graph');
	assert.equal(view.graphIssueMessage({
		kind: 'graph_disconnected',
		severity: 'warning',
		message: 'Graph has 3 disconnected component(s).',
		count: 3,
		paths: [],
	}), 'The graph has 3 disconnected component(s).');
	assert.ok(viewSource.includes('this.graphIssueSeverityLabel(issue.severity)'));
	assert.ok(viewSource.includes('this.graphIssueMessage(issue, issueCount)'));
	assert.equal(viewSource.includes('graphRecommendationDisplays'), false);
	assert.ok(viewSource.includes('snapshot.recommendations.map'));
	assert.ok(viewSource.includes('path:01_knowledge -path:.parts -path:02_archive'));
	assert.equal(viewSource.includes("ui('Profile Issues', 'Profile Issues')"), false);
	assert.equal(viewSource.includes("ui('Hub Candidates', 'Hub Candidates')"), false);
	assert.equal(viewSource.includes('body.createDiv({ text: issue.message'), false);
	assert.equal(viewSource.includes('`${snapshot.errorMessage} ${recovery}`'), false);
	assert.ok(viewSource.includes("technical.createEl('p', {\n\t\t\t\t\ttext: snapshot.errorMessage"));
	assert.ok(viewSource.includes('reportUiFailure(error'));

	const unavailableView = new TracekeeperGraphHealthView({}, {
		formatDisplayTime: () => 'now',
	});
	const unavailableRoot = new FakeElement();
	unavailableView.contentEl = unavailableRoot;
	await unavailableView.render({
		ok: false,
		profile: 'advisory',
		updatedAt: new Date().toISOString(),
		errorMessage: 'RAW_GRAPH_SENTINEL',
	});
	assert.equal(collectText(unavailableRoot, 'details').includes('RAW_GRAPH_SENTINEL'), false);
	const technicalDetails = unavailableRoot.children.find((child) => child.tag === 'details');
	assert.ok(technicalDetails);
	assert.ok(collectText(technicalDetails).includes('RAW_GRAPH_SENTINEL'));

	assert.equal(viewSource.includes('createGraphHealthReviewProposal'), false);
	assert.ok(viewSource.includes('renderMaintenanceCandidates'));

	process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 47 })}\n`);
} finally {
	delete globalThis.__tracekeeperGraphTestLanguage;
	delete globalThis.__tracekeeperGraphTestNotices;
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
