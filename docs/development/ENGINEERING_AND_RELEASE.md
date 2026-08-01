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
guards against reintroducing plugin self-MCP execution. It parses JavaScript and
TypeScript module syntax rather than matching import-like comments or strings.
The Agent ecosystem gate scans every public ecosystem Markdown owner for
developer-specific paths and credential-like examples.

Static Agent-initiative characterization runs in normal verification. Real Agent
A/B evaluation uses temporary Vaults, loopback MCP, model quota, and local
redacted artifacts; it is opt-in and requires explicit authorization. Benchmark
and evaluation provenance fingerprints include tracked changes plus every
untracked path and its bytes. Conflicting closeout reports invalidate a Trace
instead of allowing the final report to overwrite earlier evidence.

Rendered Obsidian UI changes require relevant desktop verification in addition
to pure feature and ViewModel tests.

Changes to native Vault lifecycles require an isolated real-plugin matrix before
release qualification:

1. run `npm run verify`, `npm run community:check`, and `git diff --check` on
   the same candidate source;
2. package the plugin and install only into disposable temporary Vaults;
3. exercise the manifest's minimum Obsidian version and the current stable
   desktop version;
4. verify a fresh install and an upgrade from the previous published package,
   preserving existing settings, records, proposal identity, and audit history;
5. cover both Obsidian link formats and automatic-link-update modes where move
   semantics matter, plus native metadata convergence, `Vault.process()`, and
   configured `FileManager.trashFile()` behavior;
6. inspect light and dark themes, keyboard order, safe initial focus, live
   announcements, Chinese and English copy, partial failure, restart, and
   recovery instructions;
7. record the exact app versions, fixture paths, packaged artifact hashes,
   results, and unresolved limitations outside `docs/`.

Stubbed fixtures remain required for deterministic conflict and interruption
coverage, but they cannot substitute for the real-plugin matrix. Never point
this qualification at a real user Vault. A partial or unavailable version,
upgrade, accessibility, or security row blocks release readiness rather than
being inferred from another row.

For a legacy-structure migration candidate, the matrix also records pre/post
file hashes and resolved-edge counts, both link formats, automatic-link-update
enabled and disabled outcomes, every journal interruption state, and separate
migration and cleanup confirmations. Qualification fails on a copied
duplicate, overwritten target, permanently deleted file, newly unresolved
relation, unowned probe cleanup, or migration report that disagrees with its
journal.

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
checked commit. A manual dispatch stages only by default. Publication runs in a
separate write-enabled job only for a tag push or an explicit manual `publish`
decision, and only after the strict version tag resolves to the checked commit.

Release requirements:

1. Keep versions aligned across root and plugin manifests, workspace packages,
   `versions.json`, client metadata, and MCP server metadata.
2. Run `npm run verify` from the intended release commit.
3. Use a strict `x.y.z` version matching `manifest.json`; publication also
   requires that exact tag to resolve to the checked commit.
4. Use a non-publishing workflow dispatch to stage and download the exact
   attested `main.js`, `manifest.json`, and `styles.css` candidate for install
   and smoke qualification.
5. Publish only the already staged job output by tag push or explicit manual
   `publish`; the publish job downloads the same immutable Actions artifact.
6. Verify release assets and attestations before community submission; do not
   substitute unattested local uploads.

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
- the minimum-version/current-stable temporary-Vault matrix and previous-package
  upgrade matrix passed for every changed native Vault lifecycle;
- archive/history and audit/cleanup checks found no lost or duplicate proposal,
  association, or audit identity, and every partial or outcome-unknown result
  remained recoverable;
- affected dialogs passed theme, keyboard, focus, live-announcement, localized
  copy, and explicit-recovery review;
- privacy, capability, and Knowledge Change Review descriptions match executable
  behavior;
- no developer-specific path or credential remains and local installation can be
  reproduced.

Contributor credit is reserved for direct code, documentation, design, or issue
contributions. AI tools may be acknowledged as tools without implying
authorship or endorsement.
