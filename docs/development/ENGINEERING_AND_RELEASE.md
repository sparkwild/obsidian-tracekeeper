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

The tool never downloads release assets or starts Obsidian. `create` accepts
only the immutable published `0.2.3` sizes and SHA-256 values, writes a new
synthetic disposable Vault, and refuses an existing output path. The fixture
contains sixteen task, session, context, memory, Wiki, source, review, legacy,
Agent-observation, and audit records plus two unrelated protected files. The
external operator records the `before` snapshot, replaces only the three plugin
assets, runs the candidate and required restarts, then records `after`.
`qualified-assets.json` contains `bytes` and `sha256` for each retained T03
asset. Comparison rejects a missing, changed, moved, or duplicate seeded
record; any added or removed durable Tracekeeper inventory; preserved-setting
drift; retained legacy credentials; invalid current access token; legacy-token
reuse; memory-rule version mismatch; or candidate asset mismatch. The snapshots
contain only boolean credential-state evidence, never token values. The after
state must initialize onboarding, language, and managed-Skill receipt storage
without claiming an Agent connection, Skill setup evidence, or Skill ownership.
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

Before an expensive row starts, its owner records the trigger, evidence it will
decide, expected duration or quota, fixture/provenance identity, and stop
condition. One bounded diagnostic retry is allowed only after identifying an
infrastructure or fixture cause. A broader matrix, longer rerun, second retry,
model call, or untriggered 20k/full-scan row requires fresh authorization.

## Pull Requests

- Keep changes focused and explain user-visible behavior.
- Identify changes to Vault paths, MCP tools, capabilities, review states, client
  configuration, or managed Skill installation.
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

The release workflow is `.github/workflows/release.yml`. Its build job checks
out the requested ref with full tag history, runs the full verification and
package flow under read-only repository permission, generates artifact
attestations, and uploads one immutable Actions artifact named by version and
checked commit. Manual dispatch and tag push both stage only. Publication runs
in a separate write-enabled job only for an explicit manual `publish` decision,
after the strict version tag and the repository default-branch head both resolve
to the checked commit and the rebuilt assets match all three qualified staged
SHA-256 values. The write-enabled job resolves the tag and default branch again
immediately before release creation, closing the build-to-publication mutation
window. Published release assets are immutable; the workflow refuses to replace
an existing version.

For a plugin already listed in Obsidian Community Plugins, publishing a matching
GitHub Release with the required assets is the normal update distribution path;
it is not a new registry-submission workflow for every version. Tracekeeper's
staging hashes, attestations, and install smoke remain stricter internal release
policy. Community availability and the displayed Scorecard are post-publication
distribution observations, not reasons to repeat pre-publication product or
performance qualification.

Release requirements:

1. Keep versions aligned across root and plugin manifests, workspace packages,
   `versions.json`, client metadata, and MCP server metadata.
2. Run `npm run verify` from the intended release commit.
3. Use a strict `x.y.z` version matching `manifest.json`; tag staging and
   publication require that exact tag and the default-branch head to resolve to
   the checked commit.
4. Use a non-publishing workflow dispatch to stage and download the exact
   attested `main.js`, `manifest.json`, and `styles.css` candidate for install
   and smoke qualification; retain their three SHA-256 values.
5. After the strict tag exists, use a separate explicit manual `publish` with
   those qualified SHA-256 values. The workflow rebuilds the same default-branch
   commit, rejects any byte mismatch, and passes only that run's attested staged
   artifact to the write-enabled job.
6. Never overwrite or clobber an existing release. Corrective bytes require a
   new version, qualification identity, and tag.
7. Verify release assets, attestations, Community Plugins install/update, and
   the displayed safety Scorecard; do not substitute unattested local uploads.

Recheck the current official references at release time:

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [Manifest reference](https://docs.obsidian.md/Reference/Manifest)
- [Version compatibility](https://docs.obsidian.md/Reference/Versions)
- [Obsidian community releases](https://github.com/obsidianmd/obsidian-releases)

## Community Submission And Readiness

Before submission or update, confirm:

- the intended repository and default branch are public and reviewable;
- root and packaged manifests match;
- the current version maps to the correct minimum Obsidian version;
- `npm run community:check` and `npm run verify` pass;
- the matching release was built from the submitted commit;
- release assets and attestations are present;
- installation, reload, Runtime startup, client connection, and safe Recall were
  tested;
- the current-stable temporary-Vault row passed for each changed native Vault
  lifecycle, and any minimum-version or previous-package upgrade row selected
  by the change-impact map passed;
- archive/history and audit/cleanup checks found no lost or duplicate proposal,
  association, or audit identity, and every partial or outcome-unknown result
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
