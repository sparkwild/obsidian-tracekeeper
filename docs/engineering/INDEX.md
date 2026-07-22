# Engineering And Release Guide

## Repository Identity

- Product and plugin display name: `Tracekeeper`
- Repository: `obsidian-tracekeeper`
- Plugin id and MCP server key: `tracekeeper`
- MCP tool prefix: `tracekeeper.*`
- Chinese in-plugin display name: `知识库`

## Repository Layout

```text
obsidian-tracekeeper/
├─ apps/
│  ├─ obsidian-plugin/   plugin UI, settings, packaging, and runtime host
│  └─ mcp-server/        standalone composition and cross-layer smoke tests
├─ packages/
│  ├─ contracts/         structured tool contract registry
│  ├─ core/              shared vault, index, journal, and knowledge primitives
│  └─ mcp-runtime/       MCP transport, auth, sessions, and tool application adapter
├─ skills/tracekeeper/   companion Agent workflow guidance
├─ evals/agent-initiative/ deterministic local Skill-policy characterization
├─ docs/                 canonical product and engineering documentation
├─ scripts/              repository verification
└─ package.json          workspace commands and version coordination
```

Module-specific usage is documented in [the MCP server README](../../apps/mcp-server/README.md) and [the core README](../../packages/core/README.md).

## Setup And Validation

Install workspace dependencies from the repository root:

```bash
npm ci
```

Run the full repository gate before review or release:

```bash
npm run verify
```

The gate runs community metadata checks, TypeScript checks, builds, tests, plugin packaging, and `git diff --check`.
`npm run agent:ecosystem` and its fixture tests are part of this verification lane; they rebuild the manifest and flattened artifact, verify source and bundle hashes, check contract semantics and unsafe examples, and prove that the plugin embeds the complete bundle with installation safety controls and distinct evidence states.

The release workflow also rebuilds and checks tracked package artifacts with `git diff --exit-code`; generated `dist/` output must match its TypeScript source on a clean checkout.

`npm run architecture:check` rejects relative imports across workspace boundaries and guards against reintroducing the plugin's removed self-MCP execution path.

Narrower commands are useful while iterating:

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

The Agent-initiative Eval uses 37 bilingual deterministic scenarios and a frozen historical Skill fixture. It is a static policy characterization, not an observed LLM success rate and not a production missed-call metric.

The plugin workspace has pure feature tests plus onboarding acceptance, client-configuration preview/CAS, complete Skill-bundle install/update/rollback, local capability profiles, workflow diagnostics, and asynchronous index-adapter checks. Onboarding acceptance verifies bundle distribution, distinct setup evidence, external connection evidence, recall evidence, and same-principal tracked-workflow evidence. Core tests cover operation recovery, cross-process journal locking/atomic claim, and incremental index events; MCP tests cover contracts, output validation, protocol-version matrices, tools/resources/prompts, HTTP/auth/session/stream/request limits, snapshot injection, instruction isolation, task idempotency, repository-backed closeout, concurrent audit append, and writeback recovery. Rendered Obsidian UI changes still require relevant desktop verification.

## Pull Requests

- Keep changes focused and explain user-visible behavior.
- Identify changes to vault paths, MCP tools, permissions, review state, client configuration, or companion Skill installation explicitly.
- State the validation commands and manual Obsidian flows run.
- Do not test against a real user vault unless the task explicitly authorizes it; use temporary fixtures.
- Update the owning contract and status snapshot when behavior or architecture changes.

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the public contributor entry point.

## Documentation Changes

Read [the documentation index](../INDEX.md) and the target area's `INDEX.md` first. Consolidate repeated content under one owner, update inbound links, and delete a superseded document only after its durable content has been rewritten into the new owner.

Time-sensitive implementation facts belong in `docs/status/`. Root Markdown remains limited to `AGENTS.md` and the public GitHub/Obsidian community entry points listed in the documentation index.

## Release Contract

Tracekeeper's release workflow is `.github/workflows/release.yml`. It checks out the tagged ref, runs the full verification and package flow, generates artifact attestations, then creates or refreshes a GitHub release.

Release requirements:

1. Keep versions aligned across root/plugin manifests, workspace packages, `versions.json`, plugin client metadata, and MCP server metadata.
2. Run `npm run verify` from the intended release commit.
3. Use a strict `x.y.z` tag that exactly matches `manifest.json`.
4. Let the GitHub workflow build and upload `main.js`, `manifest.json`, and `styles.css` from that commit.
5. Verify release assets and attestations before community submission or update.
6. Use workflow dispatch to rebuild an existing release; do not substitute un-attested local uploads for community assets.

The current official references should be rechecked at release time:

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [Manifest reference](https://docs.obsidian.md/Reference/Manifest)
- [Version compatibility](https://docs.obsidian.md/Reference/Versions)
- [Obsidian community releases](https://github.com/obsidianmd/obsidian-releases)

## Community Submission Checklist

- Repository and intended default branch are public and reviewable.
- Root `README.md`, `LICENSE`, `manifest.json`, and `versions.json` are accurate.
- Root and packaged manifests match.
- The current manifest version maps to the correct minimum Obsidian version.
- `npm run community:check` and `npm run verify` pass.
- The matching GitHub release was built from the submitted commit.
- Release assets are `main.js`, `manifest.json`, and optional `styles.css`, with attestations generated by the workflow.
- Installation, plugin reload, local runtime startup, client connection, and a safe recall are tested.
- Privacy and security descriptions match executable behavior.

## Release Readiness Boundaries

Before public distribution, confirm there are no developer-specific paths or credentials; runtime defaults remain configurable; privacy, permission, and Review Queue behavior are visible; and local installation/reload can be reproduced.

Contributor credit is reserved for direct code, documentation, design, or issue contributions. AI tools may be acknowledged as tools, and external writing or research may be credited without implying endorsement or authorship.
