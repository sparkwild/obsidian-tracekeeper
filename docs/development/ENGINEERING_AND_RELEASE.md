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

`npm run architecture:check` enforces workspace dependency boundaries and
guards against reintroducing plugin self-MCP execution.

Static Agent-initiative characterization runs in normal verification. Real Agent
A/B evaluation uses temporary Vaults, loopback MCP, model quota, and local
redacted artifacts; it is opt-in and requires explicit authorization.

Rendered Obsidian UI changes require relevant desktop verification in addition
to pure feature and ViewModel tests.

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

The release workflow is `.github/workflows/release.yml`. It checks out the
tagged ref, runs the full verification and package flow, generates artifact
attestations, and creates or refreshes the GitHub release.

Release requirements:

1. Keep versions aligned across root and plugin manifests, workspace packages,
   `versions.json`, client metadata, and MCP server metadata.
2. Run `npm run verify` from the intended release commit.
3. Use a strict `x.y.z` tag matching `manifest.json`.
4. Let the workflow build and upload `main.js`, `manifest.json`, and
   `styles.css` from that commit.
5. Verify release assets and attestations before community submission.
6. Use workflow dispatch to rebuild an existing release; do not substitute
   unattested local uploads.

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
- privacy, capability, and Knowledge Change Review descriptions match executable
  behavior;
- no developer-specific path or credential remains and local installation can be
  reproduced.

Contributor credit is reserved for direct code, documentation, design, or issue
contributions. AI tools may be acknowledged as tools without implying
authorship or endorsement.
