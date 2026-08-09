#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const modelSource = read('src/features/review/review-queue-model.ts');
const reviewViewModelSource = read('src/features/review/review-view-model.ts');
const contextSource = read('src/features/review/review-context-model.ts');
const targetPolicySource = read('src/features/review/review-target-policy.ts');
const controllerSource = read('src/features/review/review-queue-controller.ts');
const viewSource = read('src/features/review/review-queue-view.ts');
const modalSource = read('src/features/review/review-modals.ts');
const stylesSource = read('styles.css');
const governanceSource = read('../../docs/features/KNOWLEDGE_GOVERNANCE.md');

assert.match(modelSource, /\| 'needs_completion'/);
assert.match(modelSource, /case 'needs_completion':\s*return attention === 'incomplete'/);
assert.match(modelSource, /case 'needs_review':\s*return attention === 'pending_review'/);
assert.doesNotMatch(modelSource, /case 'needs_review':\s*return attention === 'incomplete'/);

assert.match(targetPolicySource, /KNOWLEDGE_MEMORY_DIR/);
assert.match(targetPolicySource, /KNOWLEDGE_WIKI_DIR/);
assert.match(targetPolicySource, /segments\.some\(\(segment\) => segment === '\.' \|\| segment === '\.\.'/);
assert.match(contextSource, /REVIEW_TARGET_CANDIDATE_LIMIT = 8/);
assert.match(contextSource, /isReviewRemediationTargetPath/);
assert.match(contextSource, /buildReviewDiffPreview/);
assert.match(contextSource, /writeback effect|ReviewTargetContext|buildReviewDiffPreview/);
assert.match(contextSource, /sourcePathsForProposal/);
assert.match(contextSource, /taskContextForProposal/);

assert.match(controllerSource, /normalizedStatus === 'approved'/);
assert.match(controllerSource, /readMemoryProposalFile\(file\)/);
assert.match(reviewViewModelSource, /getReviewProposalValidity\(proposal,\s*targetResolution\)/);
assert.match(viewSource, /Withdraw approval and complete/);
assert.match(targetPolicySource, /isReviewRemediationTargetPath = \(value: string\)/);
assert.match(viewSource, /existing Memory\/Wiki notes in this Vault/);

assert.match(modalSource, /createEl\('select'/);
assert.match(modalSource, /Arbitrary paths are not accepted/);
assert.doesNotMatch(modalSource, /setPlaceholder\('01_knowledge\//);
assert.doesNotMatch(modalSource, /addText\(/);
assert.match(modalSource, /target note was not written/);

assert.match(viewSource, /Task and source evidence/);
assert.match(viewSource, /Current target context/);
assert.match(viewSource, /Expected (append diff|create diff|MemoryRecord create diff)/);
assert.match(viewSource, /Approval does not write/);
assert.match(viewSource, /Applied: Wiki note created/);
assert.match(viewSource, /Historical writeback effect/);
assert.match(viewSource, /does not re-infer the effect from the target/);
assert.match(contextSource, /Historical writeback effect:.*unknown/);
assert.match(contextSource, /No append or create effect is inferred/);
assert.match(viewSource, /Return for revision/);
assert.match(viewSource, /Do not accept/);

assert.match(controllerSource, /dry_run: true/);
assert.match(modalSource, /Generating writeback preview/);
assert.match(modalSource, /Confirm apply/);
assert.match(modalSource, /applyApprovedWriteback/);
assert.match(stylesSource, /\.theme-light\s*\{[\s\S]*--tracekeeper-text-success:/);
assert.match(stylesSource, /\.theme-light\s*\{[\s\S]*--tracekeeper-text-warning:/);
assert.match(stylesSource, /\.theme-light\s*\{[\s\S]*--tracekeeper-text-error:/);
assert.match(stylesSource, /--tracekeeper-text-success:[\s\S]*var\(--text-normal\)/);
assert.match(stylesSource, /\.tracekeeper-badge--success\s*\{[\s\S]*--tracekeeper-text-success/);
assert.match(stylesSource, /\.tracekeeper-badge--risk-medium\s*\{[\s\S]*--tracekeeper-text-warning/);
assert.match(stylesSource, /button\.tracekeeper-confirm-button\s*\{[\s\S]*--tracekeeper-text-success/);
assert.match(governanceSource, /incomplete proposal/i);
assert.match(governanceSource, /Memory\/Wiki/i);

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 48 })}\n`);
