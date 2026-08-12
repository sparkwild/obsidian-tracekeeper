#!/usr/bin/env node
import fs from 'node:fs';

import { resolveMinimumAppVersion } from './version_compatibility.mjs';

const REPOSITORY = 'sparkwild/obsidian-tracekeeper';
const ROOT_MANIFEST_PATH = 'manifest.json';
const PLUGIN_MANIFEST_PATH = 'apps/obsidian-plugin/manifest.json';
const PLUGIN_PACKAGE_PATH = 'apps/obsidian-plugin/package.json';
const VERSIONS_PATH = 'versions.json';
const RELEASE_WORKFLOW_PATH = '.github/workflows/release.yml';
const MCP_HANDLER_PATH = 'packages/mcp-runtime/src/handler.ts';
const PLUGIN_MAIN_PATH = 'apps/obsidian-plugin/src/main.ts';
const CODEX_SAFE_VERIFY_PATH = 'scripts/verify_codex_safe.sh';
const EXTERNAL_LOOPBACK_QA_PATH = 'scripts/qa_external_loopback.sh';
const VERIFY_PATH = 'scripts/verify.sh';
const ROOT_PACKAGE_PATH = 'package.json';
const RUNTIME_PACKAGE_PATH = 'packages/mcp-runtime/package.json';
const MCP_SERVER_PACKAGE_PATH = 'apps/mcp-server/package.json';

function readJson(path) {
	return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function fail(message) {
	throw new Error(message);
}

function assert(condition, message) {
	if (!condition) {
		fail(message);
	}
}

function main() {
	const manifest = readJson(ROOT_MANIFEST_PATH);
	const pluginManifest = readJson(PLUGIN_MANIFEST_PATH);
	const pluginPackage = readJson(PLUGIN_PACKAGE_PATH);
	const versions = readJson(VERSIONS_PATH);
	const releaseWorkflow = fs.readFileSync(RELEASE_WORKFLOW_PATH, 'utf8');
	const mcpHandler = fs.readFileSync(MCP_HANDLER_PATH, 'utf8');
	const pluginMain = fs.readFileSync(PLUGIN_MAIN_PATH, 'utf8');
	const codexSafeVerify = fs.readFileSync(CODEX_SAFE_VERIFY_PATH, 'utf8');
	const externalLoopbackQa = fs.readFileSync(EXTERNAL_LOOPBACK_QA_PATH, 'utf8');
	const verify = fs.readFileSync(VERIFY_PATH, 'utf8');
	const rootPackage = readJson(ROOT_PACKAGE_PATH);
	const runtimePackage = readJson(RUNTIME_PACKAGE_PATH);
	const mcpServerPackage = readJson(MCP_SERVER_PACKAGE_PATH);
	const communityEntry = {
		id: manifest.id,
		name: manifest.name,
		author: manifest.author,
		description: manifest.description,
		repo: REPOSITORY,
	};

	const requiredManifestKeys = ['id', 'name', 'description', 'author', 'version', 'minAppVersion', 'isDesktopOnly'];
	const allowedManifestKeys = [...requiredManifestKeys, 'authorUrl', 'fundingUrl', 'helpUrl'];
	for (const key of requiredManifestKeys) {
		assert(Object.hasOwn(manifest, key), `Root manifest is missing ${key}.`);
		assert(Object.hasOwn(pluginManifest, key), `Plugin manifest is missing ${key}.`);
	}
	for (const key of Object.keys(manifest)) {
		assert(allowedManifestKeys.includes(key), `Root manifest has invalid key ${key}.`);
	}
	for (const key of Object.keys(pluginManifest)) {
		assert(allowedManifestKeys.includes(key), `Plugin manifest has invalid key ${key}.`);
	}

	assert(/^[a-z-]+$/.test(communityEntry.id), 'Plugin id must use lowercase letters and dashes only.');
	assert(!communityEntry.id.toLowerCase().includes('obsidian'), 'Plugin id must not include "obsidian".');
	assert(!communityEntry.id.toLowerCase().endsWith('plugin'), 'Plugin id must not end with "plugin".');
	assert(!communityEntry.name.toLowerCase().includes('obsidian'), 'Plugin name must not include "Obsidian".');
	assert(!communityEntry.name.toLowerCase().endsWith('plugin'), 'Plugin name must not end with "Plugin".');
	assert(!communityEntry.name.toLowerCase().startsWith('obsi') && !communityEntry.name.toLowerCase().endsWith('dian'), 'Plugin name must not look like a variation of "Obsidian".');
	assert(!communityEntry.description.toLowerCase().includes('obsidian'), 'Description must not include "Obsidian".');
	assert(!communityEntry.description.toLowerCase().includes('this plugin'), 'Description should describe behavior directly, without "this plugin".');
	assert(/[.?!)]$/.test(communityEntry.description), 'Description must end with punctuation.');
	assert(communityEntry.description.length <= 250, 'Description must be 250 characters or fewer.');
	assert(/^\d+\.\d+\.\d+$/.test(manifest.version), 'Version must use strict x.y.z SemVer.');
	assert(resolveMinimumAppVersion(versions, manifest.version) === manifest.minAppVersion, 'versions.json must resolve the current plugin version to minAppVersion.');
	assert(manifest.authorUrl !== 'https://obsidian.md', 'authorUrl must not point to the Obsidian website.');
	assert(!manifest.authorUrl?.toLowerCase().includes(`github.com/${REPOSITORY.toLowerCase()}`), 'authorUrl must not point to the plugin repository.');

	for (const key of ['id', 'name', 'version', 'minAppVersion', 'description', 'author', 'authorUrl', 'isDesktopOnly']) {
		assert(pluginManifest[key] === manifest[key], `Plugin manifest ${key} must match root manifest.`);
	}
	assert(pluginPackage.version === manifest.version, 'Plugin package version must match root manifest.');
	assert(pluginPackage.description === manifest.description, 'Plugin package description must match root manifest.');
	assert(mcpHandler.includes(`MCP_SERVER_VERSION = '${manifest.version}'`), 'MCP server version constant must match root manifest.');
	assert(pluginMain.includes('StreamableHttpMcpRuntime'), 'Plugin must compose the shared MCP runtime package.');
	assert(releaseWorkflow.includes('workflow_dispatch:'), 'Release workflow must support explicit publication of a qualified draft.');
	assert(releaseWorkflow.includes("build:\n    if: github.event_name == 'push'"), 'Strict version tag pushes must build the release candidate.');
	assert(releaseWorkflow.includes('id-token: write'), 'Release workflow must grant id-token: write for artifact attestations.');
	assert(releaseWorkflow.includes('attestations: write'), 'Release workflow must grant attestations: write.');
	assert(!releaseWorkflow.includes('artifact-metadata: write'), 'Binary release attestation must not receive unused artifact-metadata write permission.');
	assert(releaseWorkflow.includes('actions/attest@'), 'Release workflow must generate GitHub artifact attestations.');
	assert(releaseWorkflow.includes('fetch-depth: 0'), 'Release workflow must fetch the version tag before binding it to the checked commit.');
	assert(releaseWorkflow.split('refs/tags/$VERSION^{commit}').length - 1 >= 3, 'Build, draft, and publish jobs must resolve the exact version tag commit.');
	assert(releaseWorkflow.includes('TAG_SHA') && releaseWorkflow.includes('CHECKED_SHA'), 'Release workflow must reject a version tag and checkout SHA mismatch.');
	assert(releaseWorkflow.includes('actions/upload-artifact@'), 'Release workflow must transfer exact candidate assets without rebuilding them.');
	assert(releaseWorkflow.includes("draft:\n    needs: build\n    if: github.event_name == 'push'"), 'Tag qualification must create a draft in a separate write-enabled job.');
	assert(releaseWorkflow.includes('Create GitHub draft release') && releaseWorkflow.includes('--draft'), 'Qualified tag assets must enter an unpublished GitHub draft release.');
	assert(releaseWorkflow.includes('--generate-notes'), 'Draft release creation must include release notes.');
	assert(releaseWorkflow.includes("publish:\n    if: github.event_name == 'workflow_dispatch'"), 'Release publication must require an explicit manual workflow dispatch.');
	assert(releaseWorkflow.includes('gh release download "$VERSION"'), 'Publication must download the exact draft release assets.');
	assert(releaseWorkflow.includes('gh attestation verify "candidate/$asset"'), 'Publication must verify every downloaded draft asset attestation.');
	assert(releaseWorkflow.includes('gh release edit "$VERSION" --draft=false'), 'Publication must promote the verified draft without rebuilding or replacing assets.');
	assert(releaseWorkflow.includes("'.isDraft'"), 'Publication must require the target release to remain an unpublished draft.');
	assert(!releaseWorkflow.includes('expected_main_sha256') && !releaseWorkflow.includes('expected_manifest_sha256') && !releaseWorkflow.includes('expected_styles_sha256'), 'Publication must not require manually copied candidate hashes.');
	assert(!releaseWorkflow.includes('sha256sum'), 'Publication must verify the draft assets directly instead of hashing a second build.');
	assert(releaseWorkflow.split('refs/remotes/origin/$DEFAULT_BRANCH').length - 1 >= 3, 'Build, draft, and publish jobs must validate the default branch.');
	assert(releaseWorkflow.includes('git merge-base --is-ancestor "$TAG_SHA" "$DEFAULT_SHA"'), 'Publication must require the release tag to remain on the default branch.');
	assert(releaseWorkflow.includes('DEFAULT_MANIFEST_VERSION') && releaseWorkflow.includes('Default-branch manifest version'), 'Publication must require the default-branch manifest to advertise the release version.');
	assert(releaseWorkflow.includes('Revalidate draft identity') && releaseWorkflow.includes('refusing draft creation'), 'Draft creation must revalidate tag and default-branch identity after the build.');
	assert(releaseWorkflow.includes('already exists; refusing to replace its assets'), 'Release workflow must refuse existing release replacement.');
	assert(releaseWorkflow.includes('--verify-tag'), 'Release creation must require the existing strict version tag.');
	assert(!releaseWorkflow.includes('--clobber'), 'Release workflow must never clobber existing release assets.');
	assert(releaseWorkflow.includes('apps/obsidian-plugin/plugin/main.js'), 'Release workflow must upload the packaged main.js.');
	assert(releaseWorkflow.includes('apps/obsidian-plugin/plugin/manifest.json'), 'Release workflow must upload the packaged manifest.json.');
	assert(releaseWorkflow.includes('apps/obsidian-plugin/plugin/styles.css'), 'Release workflow must upload the packaged styles.css.');

	assert(rootPackage.scripts?.['verify:codex-safe'] === 'bash ./scripts/verify_codex_safe.sh', 'Root package must expose the bounded Codex-safe verification lane.');
	assert(rootPackage.scripts?.['qa:external-loopback'] === 'bash ./scripts/qa_external_loopback.sh', 'Root package must expose the guarded external loopback QA lane.');
	assert(rootPackage.scripts?.['release:upgrade-fixture'] === 'node ./scripts/release_upgrade_fixture.mjs', 'Root package must expose the deterministic previous-release upgrade fixture tool.');
	assert(rootPackage.scripts?.['release:upgrade-fixture:test'] === 'node --test ./scripts/release_upgrade_fixture.test.mjs', 'Root package must expose upgrade fixture regression tests.');
	assert(verify.includes('run_root_script release:upgrade-fixture:test'), 'Full verification must run upgrade fixture regression tests.');
	assert(codexSafeVerify.includes('run_root_script release:upgrade-fixture:test'), 'Codex-safe verification must run upgrade fixture regression tests.');
	assert(codexSafeVerify.includes('test:non-listener packages/mcp-runtime'), 'Codex-safe verification must use the explicit Runtime non-listener allowlist.');
	assert(codexSafeVerify.includes('test:non-listener apps/mcp-server'), 'Codex-safe verification must use the explicit MCP Server non-listener allowlist.');
	assert(!codexSafeVerify.includes('test:loopback'), 'Codex-safe verification must not invoke listener-bearing loopback tests.');
	assert(!codexSafeVerify.includes('qa:external-loopback'), 'Codex-safe verification must not invoke external loopback QA.');
	assert(!codexSafeVerify.includes('npm run test --workspaces'), 'Codex-safe verification must not use the workspace test wildcard.');

	const runtimeNonListener = runtimePackage.scripts?.['test:non-listener'] || '';
	const runtimeLoopback = runtimePackage.scripts?.['test:loopback'] || '';
	const mcpServerNonListener = mcpServerPackage.scripts?.['test:non-listener'] || '';
	const mcpServerLoopback = mcpServerPackage.scripts?.['test:loopback'] || '';
	assert(runtimeNonListener.includes('source-request.test.mjs'), 'Runtime non-listener allowlist must include Source Request regression coverage.');
	assert(!runtimeNonListener.includes('local-oauth.test.mjs') && !runtimeNonListener.includes('*.test.mjs'), 'Runtime non-listener allowlist must exclude OAuth and test wildcards.');
	assert(runtimeLoopback.includes('local-oauth.test.mjs') && !runtimeLoopback.includes('*.test.mjs'), 'Runtime loopback lane must name the fixed OAuth test explicitly.');
	assert(!mcpServerNonListener.includes('smoke.mjs'), 'MCP Server non-listener allowlist must exclude protocol smoke.');
	assert(mcpServerLoopback === 'node ./scripts/smoke.mjs', 'MCP Server loopback lane must name only the fixed protocol smoke script.');

	const externalRunIndex = externalLoopbackQa.indexOf('npm run test:loopback');
	const externalAuthorizationIndex = externalLoopbackQa.indexOf('TRACEKEEPER_EXTERNAL_LOOPBACK_QA');
	const externalCleanIndex = externalLoopbackQa.indexOf('status --porcelain --untracked-files=all');
	const externalCandidateIndex = externalLoopbackQa.indexOf('TRACEKEEPER_CANDIDATE_SHA');
	assert(externalRunIndex > 0, 'External loopback QA must run the named loopback scripts.');
	assert(externalAuthorizationIndex >= 0 && externalAuthorizationIndex < externalRunIndex, 'External loopback QA authorization guard must run before listener tests.');
	assert(externalCleanIndex >= 0 && externalCleanIndex < externalRunIndex, 'External loopback QA clean-worktree guard must run before listener tests.');
	assert(externalCandidateIndex >= 0 && externalCandidateIndex < externalRunIndex, 'External loopback QA candidate guard must run before listener tests.');

	console.log(JSON.stringify({ result: 'pass', communityEntry }, null, 2));
}

main();
