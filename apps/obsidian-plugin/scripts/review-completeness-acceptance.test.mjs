#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const modelSource = read('src/features/review/review-queue-model.ts');
const contextSource = read('src/features/review/review-context-model.ts');
const targetPolicySource = read('src/features/review/review-target-policy.ts');
const controllerSource = read('src/features/review/review-queue-controller.ts');
const viewSource = read('src/features/review/review-queue-view.ts');
const modalSource = read('src/features/review/review-modals.ts');
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
assert.match(contextSource, /Approved Writeback:/);
assert.match(contextSource, /sourcePathsForProposal/);
assert.match(contextSource, /taskContextForProposal/);

assert.match(controllerSource, /normalizedStatus === 'approved'/);
assert.match(controllerSource, /readMemoryProposalFile\(file\)/);
assert.match(controllerSource, /getReviewProposalValidity\(currentProposal, \{ exists: targetExists \}\)/);
assert.match(controllerSource, /Incomplete proposals cannot be approved/);
assert.match(controllerSource, /isReviewRemediationTargetPath\(normalizedTarget\)/);
assert.match(controllerSource, /existing Memory or Wiki note/);

assert.match(modalSource, /createEl\('select'/);
assert.match(modalSource, /Arbitrary paths are not accepted/);
assert.doesNotMatch(modalSource, /setPlaceholder\('01_knowledge\//);
assert.doesNotMatch(modalSource, /addText\(/);
assert.match(modalSource, /target note was not written/);

assert.match(viewSource, /Task and source evidence/);
assert.match(viewSource, /Current target context/);
assert.match(viewSource, /Expected append diff/);
assert.match(viewSource, /Approval does not write/);
assert.match(viewSource, /Return for revision/);
assert.match(viewSource, /Do not accept/);

assert.match(controllerSource, /dry_run: true/);
assert.match(modalSource, /Generating writeback preview/);
assert.match(modalSource, /Confirm apply/);
assert.match(modalSource, /applyApprovedWriteback/);
assert.match(governanceSource, /incomplete proposal/i);
assert.match(governanceSource, /Memory\/Wiki/i);

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 36 })}\n`);
