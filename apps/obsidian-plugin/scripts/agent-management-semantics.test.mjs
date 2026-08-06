#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mainSource = fs.readFileSync('src/main.ts', 'utf8');
const skillPromptSource = fs.readFileSync('src/features/skill-installation/client-skill-prompt.ts', 'utf8');

const atomicStart = mainSource.indexOf('async revokeAndRemoveAgentIntegration');
const atomicEnd = mainSource.indexOf('async revokeAllAgentAccess', atomicStart);
assert.ok(atomicStart >= 0 && atomicEnd > atomicStart, 'atomic per-card revoke must exist before global revoke');
const atomicSource = mainSource.slice(atomicStart, atomicEnd);
assert.match(atomicSource, /settings\.agentIntegrations = previous\.filter/);
assert.match(atomicSource, /await this\.saveSettings\(\)/);
assert.match(atomicSource, /pendingOAuthDecisions\.set\(requestId, \{ decision: 'deny' \}\)/);
assert.match(atomicSource, /closeSessionsForIntegration/);
assert.doesNotMatch(atomicSource, /revokeAgentIntegration\(/);
assert.equal(mainSource.includes('forgetAgentIntegration'), false);

const oauthStart = mainSource.indexOf('revokeOAuthCredential: async');
const oauthEnd = mainSource.indexOf('\n\t\t};', oauthStart);
const oauthSource = mainSource.slice(oauthStart, oauthEnd);
assert.match(oauthSource, /revokeAgentIntegration\(integrationId\)/);
assert.doesNotMatch(oauthSource, /revokeAndRemoveAgentIntegration/);

const globalStart = mainSource.indexOf('async revokeAllAgentAccess');
const globalEnd = mainSource.indexOf('getPendingOAuthRequests', globalStart);
const globalSource = mainSource.slice(globalStart, globalEnd);
assert.match(globalSource, /settings\.agentIntegrations = \[\]/);
assert.match(globalSource, /pendingOAuthDecisions\.clear\(\)/);
assert.match(globalSource, /pendingOAuthRequests\.clear\(\)/);
assert.match(globalSource, /closeSessionsForIntegration/);

assert.match(skillPromptSource, /presentation\?: 'compact' \| 'optional' \| 'modal-collapsible'/);
assert.match(skillPromptSource, /expanded\?: boolean/);
assert.match(skillPromptSource, /onExpandedChange\?: \(expanded: boolean\) => void/);
assert.match(skillPromptSource, /createEl\(collapsible \? 'summary' : 'div'/);
assert.match(skillPromptSource, /addEventListener\('toggle'/);
assert.match(skillPromptSource, /prompt\.label/);

process.stdout.write(`${JSON.stringify({ result: 'pass', checks: 20 })}\n`);
