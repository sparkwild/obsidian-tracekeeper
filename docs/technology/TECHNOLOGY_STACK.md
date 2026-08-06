# Technology Stack

Tracekeeper selects technologies that preserve a local, inspectable Obsidian
product and a bounded Agent integration.

## Application And Language

- The codebase is a TypeScript and Node.js npm workspace.
- The production product is an Obsidian desktop plugin and uses the Obsidian
  plugin, Vault, View, Modal, Command, Setting, and lifecycle APIs.
- Production code uses only public Obsidian plugin APIs declared by the
  supported API package. Native move, link generation, atomic file processing,
  metadata convergence, and configured trash use `FileManager` or `Vault`
  methods rather than private configuration access or adapter internals.
- Plugin UI defaults to native Obsidian primitives and local styles. A UI
  dependency requires a real-plugin proof for bundle size, theme variables, CSS
  isolation, keyboard behavior, accessibility, and cleanup.

## Storage

- Markdown files and attachments in the active Vault are the durable source of
  truth.
- Rebuildable in-memory indexes accelerate reads but do not become a database or
  independent knowledge store.
- JSON operation journals under Tracekeeper's control area may coordinate local
  recovery; they are operational state rather than knowledge.
- No hosted database, remote vector store, or cloud control plane is required.

## Agent Protocol

- Production Agent access uses MCP Streamable HTTP hosted by desktop Obsidian.
- The Runtime supports the negotiated MCP versions declared by the current
  contract and requires the negotiated version on subsequent requests.
- The Runtime exposes bounded tools, fixed resources, and capability-filtered
  prompts. Tracekeeper knowledge tasks remain separate from MCP asynchronous
  Tasks.
- A future compatibility bridge may forward to the same Obsidian-hosted
  endpoint only when a measured client requirement justifies it; it cannot
  become a second server or Vault reader.

## Workspace And Tooling

- `packages/contracts` owns structured public tool contracts.
- `packages/core` owns reusable knowledge and Vault primitives, including
  MemoryRecord v2 parsing and lifecycle resolution, typed Source planning, and
  Doctor diagnostics.
- `packages/mcp-runtime` owns transport, authentication, sessions, protocol
  surfaces, and application adaptation.
- `apps/obsidian-plugin` and `apps/mcp-server` are composition roots.
- npm scripts provide type checking, builds, tests, packaging, architecture
  checks, Agent ecosystem checks, and local evaluation tooling.
- Compatibility is qualified in isolated temporary Vaults on the manifest's
  minimum Obsidian version and the current stable desktop version. Native API
  behavior and the previous packaged-plugin upgrade path require real-plugin
  evidence in addition to stubbed unit fixtures.
- GitHub Actions builds release assets and artifact attestations from the tagged
  source commit.

Concrete setup, verification, and release commands belong to
[Engineering And Release](../development/ENGINEERING_AND_RELEASE.md).
