import assert from 'node:assert/strict';
import test from 'node:test';

import { assertCandidateSource, assertCommunityTransition, missingDraftFiles } from './plugin_release.mjs';

const baseSha = 'a'.repeat(40);
const candidateSha = 'b'.repeat(40);
const version = '0.7.2';
const baseManifest = { id: 'tracekeeper', version: '0.7.1', minAppVersion: '1.11.0', isDesktopOnly: true };
const baseVersions = { '0.2.3': '1.8.7', '0.3.2': '1.11.0' };

test('ordinary PRs preserve the advertised version and compatibility', () => {
	assert.equal(assertCommunityTransition(baseManifest, baseManifest, baseVersions, baseVersions), false);
	assert.throws(() => assertCommunityTransition(baseManifest, { ...baseManifest, minAppVersion: '1.13.0' },
		baseVersions, baseVersions), /requires a new release/);
	assert.throws(() => assertCommunityTransition(baseManifest, { ...baseManifest, version: '0.7.0' },
		baseVersions, baseVersions), /must advance/);
});

test('a version PR preserves the last stable fallback when the compatibility floor rises', () => {
	const candidate = { ...baseManifest, version, minAppVersion: '1.13.0' };
	const candidateVersions = { ...baseVersions, '0.7.1': '1.11.0', [version]: '1.13.0' };
	assert.equal(assertCommunityTransition(baseManifest, candidate, baseVersions, candidateVersions), true);
	assert.throws(() => assertCommunityTransition(baseManifest, candidate, baseVersions, { ...baseVersions, [version]: '1.13.0' }),
		/expected compatibility boundaries/);
	assert.throws(() => assertCommunityTransition(baseManifest, { ...candidate, version: '0.07.2' },
		baseVersions, candidateVersions), /strict x\.y\.z/);
});

test('the build and draft reject a moved tag, mismatched branch, or stale release base', () => {
	const source = {
		expectedSha: candidateSha, tagSha: candidateSha, branchSha: candidateSha, mainSha: baseSha, parents: [baseSha],
	};
	assert.doesNotThrow(() => assertCandidateSource(source));
	assert.throws(() => assertCandidateSource({ ...source, tagSha: baseSha }), /expected candidate commit/);
	assert.throws(() => assertCandidateSource({ ...source, branchSha: baseSha }), /release branch head/);
	assert.throws(() => assertCandidateSource({ ...source, mainSha: 'c'.repeat(40) }), /current main head/);
	assert.throws(() => assertCandidateSource({ ...source, parents: [baseSha, candidateSha] }), /single commit/);
});

const files = ['main.js', 'manifest.json', 'styles.css'].map((name, index) => ({
	name,
	size: 200 + index,
	digest: 'sha256:' + String(index).repeat(64),
}));

const uploaded = files.map((file, index) => ({ ...file, id: 11 + index, state: 'uploaded' }));
const draft = { id: 1, tag_name: version, target_commitish: candidateSha, draft: true, prerelease: false, assets: uploaded };

test('retrying an identical draft only uploads the missing files', () => {
	assert.deepEqual(missingDraftFiles({ ...draft, assets: [uploaded[0]] }, version, candidateSha, files), files.slice(1));
	assert.deepEqual(missingDraftFiles(draft, version, candidateSha, files), []);
});

test('a different candidate, public release, or conflicting upload stops all draft writes', () => {
	assert.throws(() => missingDraftFiles(draft, version, baseSha, files), /tagged candidate commit/);
	assert.throws(() => missingDraftFiles({ ...draft, draft: false }, version, candidateSha, files), /already public/);
	assert.throws(() => missingDraftFiles({ ...draft, assets: [{ ...uploaded[0], size: 12 }] }, version, candidateSha, files),
		/conflicts with the candidate/);
	assert.throws(() => missingDraftFiles({ ...draft, assets: [{ ...uploaded[0], state: 'starter' }] }, version, candidateSha, files),
		/incomplete upload/);
});
