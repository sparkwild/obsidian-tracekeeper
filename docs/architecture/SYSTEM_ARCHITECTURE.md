# System Architecture

## System Shape

```text
AI Agent
   │  Companion Skill: workflow habits
   │  MCP Streamable HTTP: bounded capabilities
   ▼
Obsidian-hosted local MCP Runtime
   │
   ├─ contract-driven protocol and capability enforcement
   ├─ application use cases and recoverable coordination
   ├─ event-driven knowledge snapshot
   ▼
Active local Obsidian Vault
   ▲
   │  native Obsidian views, settings, and review actions
   │
User
```

Desktop Obsidian owns the only production Runtime lifecycle. The standalone MCP
process is a development and smoke-test composition, not a second production
architecture.

## Component Ownership

| Component | Owns | Must not become |
| --- | --- | --- |
| `apps/obsidian-plugin` | Composition, Obsidian adapters, Runtime lifecycle, native UI, onboarding, review, and confirmed client integration | A second knowledge store or duplicate application kernel |
| `apps/mcp-server` | Standalone Node composition and cross-layer smoke tests | A separate production Runtime |
| `packages/contracts` | Public and compatibility tool identity, capability, effect, idempotency, workflow role, schemas, and deprecation metadata | A transport or UI package |
| `packages/mcp-runtime` | MCP protocol, authentication, sessions, structured results/actions, dispatch adaptation, and limits | The owner of Agent workflow habits |
| `packages/core` | Markdown, paths, repository ports, indexing, Recall, graph, lint, journal, and knowledge primitives | An Obsidian UI or client-integration layer |
| `skills/tracekeeper` | Agent mode selection, Recall, closeout, recovery, and instruction-isolation guidance | Permission enforcement or a duplicate server |
| Vault | Operational records, durable knowledge, sources, proposals, and archive | An opaque cache hidden from the user |

Shared rules belong in the lowest reusable owner. Applications depend on package
exports; one application does not import another application's source or tracked
build output.

## Production Composition And Lifecycle

The plugin composes one Vault repository, event source, knowledge index,
operation journal, application surface, MCP Runtime, and feature-controller set.
Features do not create independent Runtime, index, or repository instances.

Runtime start, restart, stop, and unload are serialized through one lifecycle
controller:

```text
stopped -> starting -> running -> stopping -> stopped
                    \-> port_conflict
                    \-> failed
```

Unload closes the lifecycle controller before releasing the index, so queued
settings work cannot reopen the listener after Obsidian unloads. A configured
port conflict is visible and fail-closed; Tracekeeper never silently chooses
another port that no longer matches confirmed client configuration.

## Agent Interaction Boundary

The [Agent Workflow](../features/AGENT_WORKFLOW.md) defines the three workflow
modes and Agent habits. The Runtime never trusts the Skill for authorization.

Public tools come from one contract registry. Discovery uses deterministic order
and the authenticated principal's capability set; dispatch performs the same
capability check. Results provide validated structured content plus equivalent
compact JSON text. Structured actions carry stable identities, timing, reason
codes, required capabilities, and executable arguments.

Project-aware workflows use one Runtime-owned identity resolver. The Runtime
returns canonical project identity, confidence, and warnings; ambiguous or
conflicting evidence does not cause a guessed project selection. A started task
stores that identity, and later context or closeout input cannot silently change
it.

## Human And Agent Entry Points

External Agents initiate bounded knowledge operations through MCP. The Obsidian
plugin is the human governance surface for connection, status, policy,
inspection, review, graph suggestions, and structure migration.

Plugin UI calls the local application surface directly. It does not create an
internal MCP client or duplicate the Agent's operational workflow as plugin
commands. Native Obsidian APIs remain the default UI boundary.

Streamable HTTP is the supported client transport. Tracekeeper does not publish
an independent SSE or stdio server profile. A future stdio compatibility bridge
may forward JSON-RPC to the same Obsidian-hosted endpoint only when a measured
client requirement justifies it. Such a bridge must fail when Obsidian is not
hosting the Runtime and cannot read the Vault, implement tools, or maintain an
index.

## Related Architecture

- [Knowledge Runtime](KNOWLEDGE_RUNTIME.md) owns the Vault model, indexing,
  repository ports, read flow, recoverable writes, and confirmed Vault-outside
  integration.
- [Trust Boundaries](TRUST_BOUNDARIES.md) owns authentication, filesystem,
  capability, privacy, and human-review enforcement.
- [Technology Stack](../technology/TECHNOLOGY_STACK.md) records the accepted
  technologies used by these boundaries.

## Architecture Invariants

- Markdown in the active Vault remains the reconstructible knowledge source.
- Production Agent access is local, loopback-bound, and credential-protected.
- MCP cannot read outside the active Vault or inside its Obsidian configuration.
- Agent guidance cannot expand Runtime permissions.
- Global durable memory remains review-gated by default.
- Automatic and approved writes are attributable and recoverable in proportion
  to their risk.
- Compatibility code may read old layouts, but new content uses the current
  three-root architecture.
