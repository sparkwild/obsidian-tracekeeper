# Engineering And Release

## Repository Identity

- Product and plugin display name: `Tracekeeper`
- Repository: `obsidian-tracekeeper`
- Plugin id and MCP server key: `tracekeeper`
- MCP tool prefix: `tracekeeper.*`
- Chinese in-plugin display name: `知识库`

The accepted stack and package responsibilities are described in
[Technology Stack](../technology/TECHNOLOGY_STACK.md) and
[System Architecture](../architecture/SYSTEM_ARCHITECTURE.md).

## Repository Layout

```text
apps/obsidian-plugin/    plugin UI, packaging, and production Runtime host
apps/mcp-server/         standalone development composition and smoke tests
packages/contracts/      structured public tool contracts
packages/core/           reusable Vault, index, journal, and knowledge primitives
packages/mcp-runtime/    MCP transport, authentication, sessions, and adaptation
skills/tracekeeper/      companion Agent workflow guidance
evals/agent-initiative/  deterministic characterization and opt-in real Agent runner
docs/                    durable project documentation
scripts/                 repository verification and packaging
```

Module-specific usage belongs in the module README. Cross-module behavior and
standards link to the owning document under `docs/`.

## Setup And Validation

Install dependencies from the repository root:

```bash
npm ci
```

Run the full repository gate before review or release:

```bash
npm run verify
```

The gate covers community metadata, TypeScript, builds, tests, plugin packaging,
Agent ecosystem consistency, and diff hygiene. The release workflow additionally
rebuilds tracked package artifacts and requires generated output to match source
on a clean checkout.

The plugin build writes its canonical workspace bundle to
`apps/obsidian-plugin/main.js` and an ignored, byte-identical compatibility
mirror to repository-root `main.js` for community build scanners that inspect
only conventional root output locations. Verification compares those files.
Packaging and release qualification continue to use only
`apps/obsidian-plugin/plugin/main.js`, `manifest.json`, and `styles.css`; the
root mirror is never a release asset.

Use narrower checks while iterating:

```bash
npm run community:check
npm run agent:ecosystem
npm run architecture:check
npm run eval:agent-initiative:test
npm run eval:agent-initiative:compare
npm run typecheck
npm run build
npm run test
npm run package
```

Choose the verification lane before running tests:

- model-assisted and restricted-environment work uses static checks, focused
  in-process tests, explicit non-listener test-file allowlists, and post-fix safe
  regressions through `npm run verify:codex-safe`; that command deliberately
  avoids workspace test wildcards and names the Runtime and MCP Server files
  that do not start local OAuth or MCP listeners;
- deterministic loopback qualification runs only the fixed bind, lifecycle,
  OAuth interoperability, and protocol smoke rows required by the release
  contract, on a normal CI runner or through a human-operated disposable Vault;
- completed loopback results must record the exact candidate, runner, commands,
  fixture identity, redaction status, and outcome before they can support release
  qualification.

The first lane is the normal Codex-assisted development path. The second is
ordinary product QA rather than model-driven security testing. Neither lane may
substitute exploit reproduction, port scanning, authentication-bypass probing,
or a full-repository cyber-security scan for the focused review required by
[SECURITY_REVIEW.md](SECURITY_REVIEW.md).

`npm run verify:codex-safe` is correction evidence, not the release gate. The
exact clean candidate must still pass `npm run verify` in the deterministic
external lane before release qualification can advance.

Run the fixed automated external portion as:

```bash
export TRACEKEEPER_EXTERNAL_LOOPBACK_QA=1
export TRACEKEEPER_CANDIDATE_SHA="$(git rev-parse HEAD)"
npm run qa:external-loopback
```

The command refuses a dirty worktree or a SHA that does not equal `HEAD`.

`npm run architecture:check` enforces workspace dependency boundaries and
guards against reintroducing plugin self-MCP execution. It parses every plugin
production source file, rejects MCP-client/network transport
modules and browser client APIs, and ignores import-like comments or strings.
The Agent ecosystem gate scans every public ecosystem Markdown owner for
developer-specific paths and credential-like examples.

Static Agent-initiative characterization runs in normal verification. Real Agent
A/B evaluation uses temporary Vaults, loopback MCP, model quota, and local
redacted artifacts; it is opt-in, requires explicit authorization, and is not a
Community Plugin release gate. Benchmark and evaluation provenance fingerprints
include tracked changes plus every untracked path and its bytes. Conflicting
closeout reports invalidate a Trace instead of allowing the final report to
overwrite earlier evidence.

Rendered Obsidian UI changes require relevant desktop verification in addition
to pure feature and ViewModel tests.

Log-storage changes additionally require v1/v2 round-trip, missing-key,
interrupted publication, exact-retry, and whole-Vault backup/restore fixtures.
The previous-package upgrade row must use the published 0.5.1 package when
qualifying the hidden-log migration. Compare protected knowledge bytes separately
from the explicitly migrated operational inventory; do not relax the general
upgrade fixture's inventory checks. Scale evidence uses 1k, 10k, and 20k records,
reports file counts, compression, latency, I/O, and memory, and verifies that cold
records preserve the original retry results. Keep generated evidence outside
`docs/` and never run migrations against the developer's real Vault as a test.

Changes to native Vault lifecycles require an isolated real-plugin acceptance
row before release qualification. Build one change-impact map first, then select
only the applicable rows:

1. run `npm run verify`, `npm run community:check`, and `git diff --check` on
   the same candidate source;
2. package the plugin and install only into disposable temporary Vaults;
3. always exercise current-stable desktop behavior for the changed native
   surface; select the manifest minimum version when a compatibility-sensitive
   API, native behavior, or `minAppVersion` changes, or when no equivalent
   retained evidence covers that surface;
4. select the previous-package upgrade row when durable settings, records,
   credentials, Vault layout, migration, or recovery behavior changes;
5. cover both Obsidian link formats and automatic-link-update modes only where
   move semantics matter, plus the native APIs touched by the change;
6. inspect light/dark themes, keyboard order, safe initial focus, live
   announcements, localized copy, partial failure, restart, and recovery only
   for changed rendered surfaces;
7. select another desktop OS only for platform-specific code, filesystem or
   packaging behavior, or an explicit new support claim;
8. record exact app versions, fixture paths, packaged artifact hashes, results,
   evidence reused from an owning workstream, and unresolved limitations
   outside `docs/`.

One real-Obsidian run may satisfy several workstreams when it exercises the same
version, package, fixture, and behavior. Record that shared ownership once; do
not schedule a duplicate matrix in each workstream.

Current-stable native MetadataCache and event-convergence acceptance is a
behavioral row. Use one serial, bounded direct-control pass in a disposable
temporary Vault:

1. record the exact Vault path, Obsidian version, packaged plugin version, and
   stopped Runtime state before mutation;
2. through the visible Obsidian UI, create two uniquely named notes, modify the
   source, rename the linked target, move the target to the configured trash,
   run one explicit index rebuild, and restart Obsidian once;
3. after each mutation, use only short read-only observations to verify index
   readiness, path presence or absence, content/hash change, and native link
   resolution; and
4. retain the bounded result outside `docs/`, including the automatic-link-
   update mode and any behavior that the row did not exercise.

Do not generate a bulk corpus, repeat the lifecycle, or broaden the matrix for
this row. One failed attempt permits only the bounded diagnostic retry defined
by the change-impact plan.

An external controller timeout does not cancel an unresolved Promise already
running inside Obsidian. Never start cleanup, retry, or another action while an
earlier action may still be active. If completion is uncertain, stop new input,
restart Obsidian completely, inspect the disposable Vault, and only then decide
whether the single bounded retry is justified. Evidence from overlapping actions
is invalid and must not be classified as a plugin failure.

Use the deterministic upgrade tool before the real-plugin upgrade row:

```bash
npm run release:upgrade-fixture -- create --assets <published-0.2.3-assets> --output <new-fixture-directory>
npm run release:upgrade-fixture -- snapshot --fixture <fixture.json> --vault <fixture-vault> --phase before --output <before.json>
npm run release:upgrade-fixture -- snapshot --fixture <fixture.json> --vault <fixture-vault> --phase after --output <after.json>
npm run release:upgrade-fixture -- compare --before <before.json> --after <after.json> --expected-target-assets <qualified-assets.json> --expected-version <x.y.z>
```

For the current previous release, add `--previous-version 0.5.0` to `create`.
That profile pins the published 0.5.0 asset bytes and hashes and verifies existing
security-secret and Agent/Skill evidence preservation. The default 0.2.3 profile
continues to verify legacy credential migration. Never substitute one profile's
credential assertions for the other.

The tool never downloads release assets or starts Obsidian. `create` accepts
only the selected immutable published `0.2.3` or `0.5.0` sizes and SHA-256 values, writes a new
synthetic disposable Vault, and refuses an existing output path. The fixture
contains sixteen task, session, context, memory, Wiki, source, review, legacy,
Agent-observation, Agent activity, and receipt records plus two unrelated protected files. The
external operator records the `before` snapshot, replaces only the three plugin
assets, runs the candidate and required restarts, then records `after`.
`qualified-assets.json` contains `bytes` and `sha256` for each retained T03
asset. Comparison rejects a missing, changed, moved, or duplicate seeded
record; any added or removed durable Tracekeeper inventory; preserved-setting
drift; retained legacy credentials; invalid current access token; legacy-token
reuse; memory-rule version mismatch; or candidate asset mismatch. The snapshots
contain only boolean credential-state evidence, never token values. The after
state must initialize onboarding, language, and Skill receipt storage without
claiming an Agent connection, Skill prompt-copy evidence, or Skill ownership.
Actual client configuration and legacy/current Skill-file interaction still
requires the isolated real-Obsidian upgrade row.

Stubbed fixtures remain required for deterministic conflict and interruption
coverage, but they cannot substitute for the real-plugin matrix. Never point
this qualification at a real user Vault. A partial or unavailable selected
version, upgrade, accessibility, or security row blocks release readiness;
unselected rows are recorded as `not_selected`, not left pending or inferred
from another row.

For a legacy-structure migration candidate, the matrix also records pre/post
file hashes and resolved-edge counts, both link formats, automatic-link-update
enabled and disabled outcomes, every journal interruption state, and separate
migration and cleanup confirmations. Qualification fails on a copied
duplicate, overwritten target, permanently deleted file, newly unresolved
relation, unowned probe cleanup, or migration report that disagrees with its
journal.

## Evidence Ownership And Cost Control

Release qualification consumes evidence; it does not duplicate every owning
workstream's suite. Classify evidence before scheduling it:

- fast continuous gates cover static checks, focused deterministic tests,
  builds, package structure, and documentation consistency while code changes;
- product acceptance covers changed behavior in disposable Vaults before the
  final candidate is frozen;
- candidate-bound gates cover the clean commit, exact package bytes, install,
  selected upgrade, staged hashes, and publication identity once the version is
  stable;
- subsystem evidence binds the relevant source, configuration, fixture,
  environment, dependency, and toolchain inputs and may be reused when a
  complete impact review records equivalence.

A different commit SHA alone does not invalidate unchanged subsystem evidence.
It does invalidate candidate-bound package and publication evidence affected by
the new bytes.

Expensive or expansive assurance is change-triggered:

- run a formal 20k index benchmark only when the normalized index, scanner,
  production adapter, Recall path, benchmark method, or a scale-relevant
  dependency/configuration/toolchain input changes;
- run replay stress only when event ordering, queueing, recovery, replay, or
  convergence logic changes;
- run extra client or desktop-platform rows only for a matching integration or
  platform-specific delta;
- keep real-model evaluation independently authorized with a default release
  quota of zero;
- keep full/deep repository security scans independently authorized. Normal
  release review is proportional and focused on changed trust boundaries.

Code refactor completion does not imply performance, Replay, real-Obsidian, or
release acceptance. Those are separately authorized qualification tasks with
their own candidate, fixture, provenance, and stop conditions; they are not
silently folded into a refactor task or inferred from focused automated checks.

Before an expensive row starts, its owner records the trigger, evidence it will
decide, expected duration or quota, fixture/provenance identity, and stop
condition. One bounded diagnostic retry is allowed only after identifying an
infrastructure or fixture cause. A broader matrix, longer rerun, second retry,
model call, or untriggered 20k/full-scan row requires fresh authorization.

## Pull Requests

- Keep changes focused and explain user-visible behavior.
- Identify changes to Vault paths, MCP tools, capabilities, review states, client
  configuration, or user-selected Skill installation and AI-assisted verification.
- Report exact automated checks and manual Obsidian flows.
- Use temporary fixtures; do not test against a real user Vault without explicit
  authorization.
- Update the owning durable document when behavior or architecture changes.
- Update an active working status or audit only when the task uses one; do not
  put progress material under `docs/`.

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the public contributor entry
point.

## Documentation Maintenance

Read [the documentation index](../INDEX.md) and the target category's
`INDEX.md` before editing.

- `overview/` owns project purpose and long-term scope.
- `features/` owns capabilities and workflow behavior.
- `technology/` owns accepted technical choices and compatibility constraints.
- `architecture/` owns structure, data flow, runtime behavior, and trust
  boundaries.
- `development/` owns build, test, release, review, and documentation rules.
- Plans, progress, dated status, research, review evidence, and handoffs remain
  outside `docs/`.

Give every topical document one primary owner, register it exactly once in that
category index, and link instead of duplicating requirements. When reorganizing,
extract durable content first, update all inbound links, and preserve working
material in its established task location.

## Release Contract

Use `main` for integration and short feature and fix branches for PRs. Each
formal version has one protected `X.Y.Z` tag. If an older line needs ongoing
support, create `maint/X.Y` from its published tag after defining its support
scope and adding a release gate for that line. The current publication path
serves the active `main` line.

[Plugin CI](../../.github/workflows/ci.yml) runs `npm ci`, `npm run verify`, and
the tracked-output check for PRs to `main`, pushes to `main`, and manual
verification. A manual run takes a full SHA reachable from the selected `main`
or `release/*` branch. Push and manual runs retain the three plugin files and
`SHA256SUMS` in a SHA-named Actions artifact for 14 days. This check uses
read-only repository permissions. Its artifact is for verification in a
disposable Vault.

### Publish and promote

Obsidian reads the stable version from the default branch's root `manifest.json`
and fetches the matching public GitHub Release. Keep that version at the last
published build until the next Release has its verified attachments.

1. From the current `main` head, open one maintainer-owned `release/X.Y.Z` PR
   to `main`. Put the version change, changelog, and resulting generated files
   in a single commit. A version bump with `npm version X.Y.Z --no-git-tag-version`
   runs the version hook and stages its changes. Review them and include any
   rebuilt tracked output before committing. The tag, root and plugin
   manifests, workspace and lockfile versions, and MCP metadata must agree.
   Set the minimum Obsidian version in both manifests. When raising it, keep
   the last compatible stable version selectable in `versions.json` and add the
   new boundary. Preserve existing mappings.
2. When **Verify plugin** passes, push the exact `X.Y.Z` tag for the PR head.
   Keep `main` and the candidate fixed until promotion. The tag workflow
   verifies the open PR, builds the exact commit, checks tracked output, runs
   the 1k knowledge-index benchmark, and attests the three package files.
   A separate job creates an unpublished draft or resumes an identical
   partial draft by uploading only the missing files. The manual 5k and 20k
   benchmark diagnostics remain a separate workflow.
3. Qualify the draft's `main.js`, `manifest.json`, and `styles.css` in a
   disposable Vault. Select the product acceptance rows from the change-impact
   map and record the exact candidate and attachment hashes.
4. Manually dispatch **Release Plugin** from `main` with the version. The
   workflow rechecks the PR and tag, downloads and verifies the three draft
   assets and their attestations, and publishes that draft as the latest
   GitHub Release.
5. Rerun the failed **Community release** check on the PR after publication.
   It checks the tag, proposed merge tree, and public release assets. Merge
   with **Create a merge commit** to retain the tagged commit in `main` history.
   Verify public asset hashes, community installation and update, and the
   displayed Scorecard after the manifest is visible. Test the fallback on an
   older Obsidian version when the compatibility floor changes.

The tag and published assets are the version's identity. A rerun may finish an
identical draft, while conflicting bytes, a moved tag, or an existing public
Release stop the write. Corrected bytes require a fresh version and tag. If
publication succeeds before the PR can merge, Obsidian still uses the previous
stable version. Resolve the promotion check against the published candidate
or qualify a new version if the merge tree changed. Fix a public regression
with a higher patch version. Use a separate Vault backup if recovery requires
reversing a data migration.

### Repository settings and recovery

- Keep `main` protected by a PR, block forced updates and deletion, and enforce
  the protections for administrators. Once both checks work on normal and
  fork PRs, require **Verify plugin** and **Community release** with the branch
  up to date. A single maintainer can review their own change with zero
  required approvals and explicitly dispatch publication.
- Restrict creation of release tags to the maintainer and separately protect
  them from updates or deletion. Tag workflows come from the tagged commit.
  Tag new releases only from the verified PR workflow above. GitHub Immutable
  Releases can lock future releases after the workflow has been exercised.
- Before retiring legacy refs, inventory open PRs, links, and consumers. Keep
  a restorable Git copy that retains the exact refs and commits, plus a copy
  of the published attachments, checksums, and release metadata. Restore a
  needed branch under its original name and SHA. Actions artifacts expire
  after their retention period.

Recheck the current official references at release time:

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [Manifest reference](https://docs.obsidian.md/Reference/Manifest)
- [Version compatibility](https://docs.obsidian.md/Reference/Versions)
- [Obsidian community releases](https://github.com/obsidianmd/obsidian-releases)

## Community Submission And Readiness

Before submission or update, confirm:

- the intended repository and default branch are public and reviewable;
- root and packaged manifests match;
- the effective `versions.json` compatibility boundary resolves to the current
  minimum Obsidian version;
- `npm run community:check` and `npm run verify` pass;
- the matching release was built from the submitted commit;
- release assets and attestations are present;
- installation, reload, Runtime startup, client connection, and safe Recall were
  tested;
- the current-stable temporary-Vault row passed for each changed native Vault
  lifecycle, and any minimum-version or previous-package upgrade row selected
  by the change-impact map passed;
- archive/history and Agent activity cleanup checks found no lost or duplicate
  proposal, association, or activity identity, and every partial or
  outcome-unknown result
  remained recoverable;
- affected dialogs passed theme, keyboard, focus, live-announcement, localized
  copy, and explicit-recovery review without multiplying unrelated platform,
  version, or client combinations;
- privacy, capability, and Knowledge Change Review descriptions match executable
  behavior;
- no developer-specific path or credential remains and local installation can be
  reproduced.

Contributor credit is reserved for direct code, documentation, design, or issue
contributions. AI tools may be acknowledged as tools without implying
authorship or endorsement.
