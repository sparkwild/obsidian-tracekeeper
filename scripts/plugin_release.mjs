import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { compareStrictVersions, ensureVersionCompatibilityBoundary } from './version_compatibility.mjs';

const ASSET_NAMES = ['main.js', 'manifest.json', 'styles.css'];
const RELEASE_WORKFLOW = '.github/workflows/release.yml';
const PLUGIN_MANIFEST = 'apps/obsidian-plugin/manifest.json';
const SHA = /^[a-f0-9]{40}$/;

function git(...args) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitJson(sha, path) {
	return JSON.parse(git('show', `${sha}:${path}`));
}

function repo() {
	const name = process.env.GITHUB_REPOSITORY;
	assert(/^[\w.-]+\/[\w.-]+$/.test(name), 'GITHUB_REPOSITORY must identify the release repository.');
	return name;
}

function gh(args, options) {
	return execFileSync('gh', args, { encoding: 'utf8', ...options });
}

function api(path, args = [], options) {
	return gh(['api', `repos/${repo()}/${path}`, ...args], options);
}

function apiJson(path, ...args) {
	return JSON.parse(api(path, args));
}

function list(path) {
	return apiJson(path, '--paginate', '--slurp').flat();
}

function tagRef(version) {
	compareStrictVersions(version, version);
	return `refs/tags/${version}`;
}

export function assertCommunityTransition(base, candidate, baseVersions, candidateVersions) {
	assert.equal(candidate.id, base.id, 'The community plugin ID is fixed.');
	const change = compareStrictVersions(candidate.version, base.version);
	assert(change >= 0, 'The advertised stable version must advance.');
	if (change === 0) {
		assert.equal(candidate.minAppVersion, base.minAppVersion, 'A new minimum Obsidian version requires a new release.');
		assert.equal(candidate.isDesktopOnly, base.isDesktopOnly, 'A platform compatibility change requires a new release.');
	}
	const expectedVersions = { ...baseVersions };
	ensureVersionCompatibilityBoundary(expectedVersions, candidate.version, candidate.minAppVersion, base.version);
	assert.deepEqual(candidateVersions, expectedVersions, 'Keep historical mappings and record the expected compatibility boundaries.');
	return change > 0;
}

function checkTransition(base, candidate) {
	return assertCommunityTransition(
		gitJson(base, 'manifest.json'),
		gitJson(candidate, 'manifest.json'),
		gitJson(base, 'versions.json'),
		gitJson(candidate, 'versions.json')
	);
}

export function assertCandidateSource({ expectedSha, tagSha, branchSha, mainSha, parents }) {
	assert(SHA.test(tagSha) && tagSha === expectedSha, 'The tag must resolve to the expected candidate commit.');
	assert.equal(tagSha, branchSha, 'The tag must point to the release branch head.');
	assert.deepEqual(parents, [mainSha], 'The release commit must be a single commit on the current main head.');
}

function releaseSource(version, expectedRef) {
	const tag = tagRef(version);
	const branch = `release/${version}`;
	git('fetch', '--no-tags', 'origin', `+${tag}:${tag}`,
		'+refs/heads/main:refs/remotes/origin/main', `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
	const tagSha = git('rev-parse', `${tag}^{commit}`);
	const mainSha = git('rev-parse', 'refs/remotes/origin/main');
	assertCandidateSource({
		expectedSha: expectedRef ? git('rev-parse', `${expectedRef}^{commit}`) : tagSha,
		tagSha,
		branchSha: git('rev-parse', `refs/remotes/origin/${branch}`),
		mainSha,
		parents: git('show', '-s', '--format=%P', tagSha).split(' '),
	});
	assert.equal(gitJson(tagSha, 'manifest.json').version, version, 'The tag must match the root manifest version.');
	assert(checkTransition(mainSha, tagSha), 'A release must advance the version advertised by main.');
	assert.equal(git('diff', '--name-only', mainSha, tagSha, '--', '.github/workflows',
		'scripts/plugin_release.mjs', 'scripts/version_compatibility.mjs'), '', 'Merge release policy changes into main before preparing a release.');

	const releasePulls = list('pulls?state=open&base=main&per_page=100').filter((pull) =>
		pull.head.repo?.full_name === repo() && pull.head.ref.startsWith('release/'));
	assert.equal(releasePulls.length, 1, 'Open exactly one release PR to main from this repository.');
	const [pull] = releasePulls;
	assert(pull.head.ref === branch && pull.head.sha === tagSha && pull.base.sha === mainSha,
		'The release PR must bind the tag to the current main head.');

	const runs = apiJson(`actions/workflows/ci.yml/runs?event=pull_request&head_sha=${tagSha}&per_page=100`).workflow_runs;
	const run = runs.find((entry) => entry.head_sha === tagSha && entry.head_branch === branch && entry.head_repository?.full_name === repo());
	assert(run, 'Run the PR verification before pushing the release tag.');
	const jobs = apiJson(`actions/runs/${run.id}/jobs?per_page=100`).jobs;
	assert(jobs.some((job) => job.name === 'Verify plugin' && job.conclusion === 'success'), 'The release PR must pass Verify plugin.');
	return tagSha;
}

function sha256(bytes) {
	return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function checkManifest(bytes, sha) {
	assert.deepEqual(JSON.parse(bytes), gitJson(sha, PLUGIN_MANIFEST), 'The packaged manifest must match the candidate plugin manifest.');
}

function packageFiles(directory, sha) {
	assert.deepEqual(readdirSync(directory).sort(), ASSET_NAMES, 'The package must contain exactly the three plugin assets.');
	return ASSET_NAMES.map((name) => {
		const path = join(directory, name);
		const bytes = readFileSync(path);
		assert(bytes.length > 0, `${name} must be nonempty.`);
		if (name === 'manifest.json') checkManifest(bytes, sha);
		return { name, path, size: bytes.length, digest: sha256(bytes) };
	});
}

function matchingRelease(version) {
	const matches = list('releases?per_page=100').filter((release) => release.tag_name === version);
	assert(matches.length < 2, 'Multiple releases match the tag.');
	return matches[0];
}

function assertReleaseIdentity(release, version, sha, draft) {
	assert(release && Number.isSafeInteger(release.id), `Expected a ${draft ? 'draft' : 'published'} Release for ${version}.`);
	assert.equal(release.tag_name, version, 'The Release tag does not match the candidate version.');
	assert.equal(release.target_commitish, sha, 'The Release must record the tagged candidate commit.');
	assert.equal(release.draft, draft, draft ? 'The Release is already public.' : 'Publish the draft before merging the version PR.');
	assert.equal(release.prerelease, false, 'Only formal releases are supported.');
	if (!draft) assert(release.published_at, 'The Release must already be public.');
}

function releaseAssets(release, allowMissing = false) {
	const assets = new Map();
	for (const asset of release.assets) {
		assert(ASSET_NAMES.includes(asset.name) && !assets.has(asset.name), `Unexpected or duplicate release asset ${asset.name}.`);
		assert(Number.isSafeInteger(asset.id) && asset.state === 'uploaded' && asset.size > 0 &&
			/^sha256:[a-f0-9]{64}$/.test(asset.digest), `Missing or incomplete upload for ${asset.name}.`);
		assets.set(asset.name, asset);
	}
	assert(allowMissing || assets.size === ASSET_NAMES.length, 'The Release must contain all three plugin assets.');
	return assets;
}

export function missingDraftFiles(release, version, sha, files) {
	assertReleaseIdentity(release, version, sha, true);
	const existing = releaseAssets(release, true);
	return files.filter((file) => {
		const uploaded = existing.get(file.name);
		if (!uploaded) return true;
		assert(uploaded.digest === file.digest && uploaded.size === file.size,
			`Draft asset ${file.name} conflicts with the candidate. Existing attachments are preserved.`);
		return false;
	});
}

function prepareDraft(version, expectedSha, directory) {
	const sha = releaseSource(version, expectedSha);
	const files = packageFiles(directory, sha);
	let draft = matchingRelease(version);
	if (!draft) {
		gh(['release', 'create', version, '--repo', repo(), '--draft', '--verify-tag',
			'--target', sha, '--title', version, '--generate-notes']);
		draft = matchingRelease(version);
	}
	const missing = missingDraftFiles(draft, version, sha, files);
	if (missing.length > 0) {
		gh(['release', 'upload', version, '--repo', repo(), ...missing.map((file) => file.path)]);
	}
	const updated = apiJson(`releases/${draft.id}`);
	assert.equal(missingDraftFiles(updated, version, sha, files).length, 0, 'Draft upload is incomplete. Retry the same candidate.');
	console.log(`Draft ${version} is ready for qualification. ${updated.html_url}`);
}

function verifyAttachments(assets, version, sha) {
	const directory = mkdtempSync(join(tmpdir(), 'tracekeeper-release-'));
	try {
		for (const name of ASSET_NAMES) {
			const asset = assets.get(name);
			const bytes = api(`releases/assets/${asset.id}`, ['-H', 'Accept: application/octet-stream'],
				{ encoding: null, maxBuffer: 32 * 1024 * 1024 });
			assert(bytes.length === asset.size && sha256(bytes) === asset.digest, `Downloaded asset ${name} differs from the Release digest.`);
			if (name === 'manifest.json') checkManifest(bytes, sha);
			const path = join(directory, name);
			writeFileSync(path, bytes);
			gh(['attestation', 'verify', path, '--repo', repo(), '--signer-workflow', `${repo()}/${RELEASE_WORKFLOW}`,
				'--source-digest', sha, '--source-ref', tagRef(version), '--deny-self-hosted-runners'], { stdio: 'inherit' });
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function assetFingerprint(assets) {
	return ASSET_NAMES.map((name) => {
		const { id, size, digest } = assets.get(name);
		return { id, size, digest };
	});
}

function publish(version) {
	const sha = releaseSource(version);
	const draft = matchingRelease(version);
	assertReleaseIdentity(draft, version, sha, true);
	const verifiedAssets = releaseAssets(draft);
	verifyAttachments(verifiedAssets, version, sha);
	releaseSource(version, sha);
	const currentDraft = apiJson(`releases/${draft.id}`);
	assertReleaseIdentity(currentDraft, version, sha, true);
	assert.deepEqual(assetFingerprint(releaseAssets(currentDraft)), assetFingerprint(verifiedAssets),
		'The draft assets changed during verification.');
	const published = apiJson(`releases/${draft.id}`, '--method', 'PATCH', '-F', 'draft=false', '-f', 'make_latest=true');
	assertReleaseIdentity(published, version, sha, false);
	console.log(`Published ${published.html_url}. Rerun Community release on the release PR before merging.`);
}

function checkPromotion() {
	const { pull_request: pull } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
	const baseSha = pull.base.sha;
	const headSha = pull.head.sha;
	const mergedSha = git('rev-parse', 'HEAD');
	assert(SHA.test(baseSha) && SHA.test(headSha), 'The PR must provide exact base and head commits.');
	assert.deepEqual(git('show', '-s', '--format=%P', mergedSha).split(' '), [baseSha, headSha],
		'The PR merge commit must match the event base and head.');
	if (!checkTransition(baseSha, mergedSha)) return;

	const version = gitJson(mergedSha, 'manifest.json').version;
	assert(pull.base.ref === 'main' && pull.head.repo?.full_name === repo() && pull.head.ref === `release/${version}`,
		`Promote ${version} through its release/${version} PR from this repository.`);
	assert.equal(git('rev-parse', `${mergedSha}^{tree}`), git('rev-parse', `${headSha}^{tree}`),
		'The proposed merge tree differs from the released candidate.');
	const tag = tagRef(version);
	git('fetch', '--no-tags', 'origin', `+${tag}:${tag}`);
	assert.equal(git('rev-parse', `${tag}^{commit}`), headSha, 'The published tag must match the release PR head.');
	const release = apiJson(`releases/tags/${version}`);
	assertReleaseIdentity(release, version, headSha, false);
	verifyAttachments(releaseAssets(release), version, headSha);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [command, version, sha, directory] = process.argv.slice(2);
	switch (command) {
	case 'package':
		for (const file of packageFiles(version, git('rev-parse', 'HEAD'))) {
			console.log(`${file.digest.slice('sha256:'.length)}  ${file.name}`);
		}
		break;
	case 'source': {
		assert.equal(process.env.GITHUB_EVENT_NAME, 'push', 'Candidate builds come from a tag push.');
		assert.equal(process.env.GITHUB_REF, tagRef(version), 'The build must use the triggering tag.');
		assert(SHA.test(sha), 'The build must receive the tag push SHA.');
		const candidate = releaseSource(version, sha);
		assert.equal(candidate, git('rev-parse', 'HEAD'), 'The build must check out the tagged candidate.');
		console.log(`version=${version}\nsha=${candidate}`);
		break;
	}
	case 'draft':
		assert.equal(process.env.GITHUB_EVENT_NAME, 'push', 'Drafts come from a tag push.');
		assert.equal(process.env.GITHUB_REF, tagRef(version), 'The draft must use the triggering tag.');
		assert(SHA.test(sha), 'The draft must receive the build commit.');
		prepareDraft(version, sha, directory);
		break;
	case 'publish':
		assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'Publication requires a manual dispatch.');
		assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Dispatch publication from main.');
		publish(version);
		break;
	case 'promote':
		checkPromotion();
		break;
	default:
		throw new Error('Select package, source, draft, publish, or promote.');
	}
}
