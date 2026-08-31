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
const mainSource = read('src/main.ts');
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
assert.match(viewSource, /existing memory or knowledge notes in this Vault/);

assert.match(modalSource, /createEl\('select'/);
assert.match(modalSource, /Arbitrary paths are not accepted/);
assert.doesNotMatch(modalSource, /setPlaceholder\('01_knowledge\//);
assert.doesNotMatch(modalSource, /addText\(/);
assert.match(modalSource, /target note was not written/);

assert.match(viewSource, /Task and source evidence/);
assert.match(viewSource, /Current target context/);
assert.match(viewSource, /Content to append|Knowledge note to create|Memory to add/);
assert.match(viewSource, /Approval does not write/);
assert.match(viewSource, /missing_memory_hub/);
assert.match(viewSource, /历史\/不完整结构阻断/);
assert.match(viewSource, /This is a legacy or incomplete structural block/);
assert.match(viewSource, /旧版提案无法可靠区分写回正文与内部标题/);
assert.match(viewSource, /该提案没有可验证的规范项目身份/);
assert.match(reviewViewModelSource, /isReviewProposalBlocked/);
assert.match(reviewViewModelSource, /return 'blocked'/);
assert.match(viewSource, /阻断原因：/);
assert.match(viewSource, /历史阻断，需重提/);
assert.match(viewSource, /Withdraw invalid approval/);
assert.doesNotMatch(viewSource, /'history',\s*'all'/);
assert.match(viewSource, /整理已处理记录/);
assert.match(viewSource, /记忆候选需要项目或全局 Hub 才能持久化/);
assert.match(viewSource, /Block reason:/);
assert.doesNotMatch(viewSource, /审核阻塞/);
assert.match(viewSource, /Applied: knowledge note created/);
assert.match(viewSource, /Historical writeback effect/);
assert.match(viewSource, /Recorded writeback target/);
assert.match(viewSource, /Only the recorded writeback target is shown/);
assert.match(viewSource, /does not re-infer the effect from the target/);
assert.match(contextSource, /Historical writeback effect:.*unknown/);
assert.match(contextSource, /appliedHistory\.targetNote \|\| '\(not recorded\)'/);
assert.doesNotMatch(contextSource, /appliedHistory\.targetNote \|\| target\.path/);
assert.match(contextSource, /No append or create effect is inferred/);
assert.match(viewSource, /Return for revision/);
assert.match(viewSource, /Do not accept/);
assert.doesNotMatch(`${viewSource}\n${modalSource}`, /变更提案|记忆提案|保存记忆候选/);
assert.doesNotMatch(`${viewSource}\n${modalSource}`, /Change proposals?|Memory proposal|Save memory candidate/);
assert.match(viewSource, /Review list/);
assert.match(viewSource, /Change details/);
assert.match(viewSource, /Technical details/);
assert.match(viewSource, /Save as memory/);
assert.match(viewSource, /Back to review list/);
assert.match(viewSource, /const REVIEW_PAGE_SIZE = 5/);
assert.match(stylesSource, /\.tracekeeper-review-inbox\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
assert.match(stylesSource, /\.tracekeeper-review-inbox__row\.is-selected[\s\S]*?var\(--interactive-accent\)/);
assert.match(modalSource, /tracekeeper-review-archive-modal__technical-details/);
assert.match(modalSource, /tracekeeper-review-apply-modal__technical-details/);
assert.match(modalSource, /targetDisplayName/);
assert.equal((viewSource.match(/\(\) => this\.refreshSelectedProposal\(proposal\.path\)/g) || []).length, 3);
assert.match(viewSource, /if \(options\.automatic && this\.showingDetail\)/);
assert.match(viewSource, /this\.automaticRefreshDeferred = true/);
assert.match(mainSource, /this\.refreshGovernanceViews\(\{ automatic: true \}\)/);
assert.match(mainSource, /view\.refresh\(\{ automatic: options\.automatic \}\)/);

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

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 70 })}\n`);
