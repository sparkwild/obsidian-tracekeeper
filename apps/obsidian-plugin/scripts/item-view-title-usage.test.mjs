#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const itemViewFiles = [
	'src/features/activity/activity-view.ts',
	'src/features/graph/graph-health-view.ts',
	'src/features/memory/memory-inspector-view.ts',
	'src/features/permissions/permission-policy-view.ts',
	'src/features/review/review-queue-view.ts',
	'src/features/runtime/runtime-log-view.ts',
	'src/features/runtime/runtime-status-view.ts',
	'src/features/sources/source-status-view.ts',
];

for (const file of itemViewFiles) {
	const source = fs.readFileSync(file, 'utf8');
	assert.ok(
		source.includes("this.containerEl.addClass('tracekeeper-item-view')"),
		`${file} must opt into the shared native ItemView chrome`
	);
	if (file !== 'src/features/activity/activity-view.ts') {
		assert.doesNotMatch(
			source,
			/tracekeeper-view__title/,
			`${file} must use its native tab title instead of rendering a duplicate content title`
		);
	}
}

const activitySource = fs.readFileSync('src/features/activity/activity-view.ts', 'utf8');
assert.match(activitySource, /AI 助手活动[\s\S]*?tracekeeper-view__title/);

const stylesSource = fs.readFileSync('styles.css', 'utf8');
assert.match(
	stylesSource,
	/\.tracekeeper-item-view\s+\.view-header-title,[\s\S]*?\.tracekeeper-item-view\s+\.view-header-title-container\s*\{[\s\S]*?display:\s*none;/
);
assert.match(
	stylesSource,
	/\.tracekeeper-item-view\s+\.view-actions\s*\{[\s\S]*?margin-left:\s*auto;/
);

process.stdout.write(`${JSON.stringify({ result: 'pass', itemViews: itemViewFiles.length })}\n`);
