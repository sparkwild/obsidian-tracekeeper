# System Architecture

## System Shape

```text
AI Agent
   │  Companion Skill: workflow habits
   │  MCP Streamable HTTP + local OAuth/PKCE
   │  per-Agent credential + fixed capabilities
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
| `apps/obsidian-plugin` | Composition, Obsidian adapters, Runtime lifecycle, per-Agent integration records, OAuth approval bridge, native UI, onboarding, review, and Skill lifecycle | A second knowledge store or duplicate application kernel |
| `apps/mcp-server` | Standalone Node composition and cross-layer smoke tests | A separate production Runtime |
| `packages/contracts` | Public and compatibility tool identity, capability, effect, idempotency, workflow role, schemas, and deprecation metadata | A transport or UI package |
| `packages/mcp-runtime` | MCP protocol, local OAuth/PKCE delivery, credential verification, integration-bound sessions, structured results/actions, dispatch adaptation, and limits | The owner of Agent workflow habits |
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

The plugin persists one integration record per client profile and at most one
active credential digest per record. Runtime composition receives a verifier,
revalidates the Bearer on every MCP request, and binds each Session to the
integration and credential that created it. A single-card revoke closes only
that card's Sessions and removes its integration and Skill-state records;
global revoke clears all integration records, credentials, pending approval
state, and Skill-state records. Client-owned Skill files are not deleted.

The same listener publishes protected-resource metadata, authorization-server
metadata, public-client registration, authorization-code, token, and revoke
endpoints. Authorization requires PKCE `S256`, an exact registered loopback
redirect URI, and the MCP resource indicator. Pending requests, unbound DCR
records, PKCE state, and one-time authorization codes are bounded memory state.
The first approved token exchange binds the OAuth client record to the selected
integration; later requests must match that binding. No refresh token is issued.

## Agent Interaction Boundary

The [Agent Workflow](../features/AGENT_WORKFLOW.md) defines the three workflow
modes and Agent habits. The Runtime never trusts the Skill for authorization.

Public tools come from one contract registry. Discovery uses deterministic order
and the fixed `local-user` capability set; dispatch performs the same capability
check. `tracekeeper.memory` is the single public generation-bound Memory
catalog across global and project scopes; the retired project-specific name is
not a public alias. The registry publishes the output schemas used by both
discovery and Runtime result validation: public top-level success/failure fields are closed,
while evidence, metadata, and diagnostics are extensible only where their
schema says so. A per-Agent Bearer gates local access but does not establish
identity from untrusted client claims. MCP `clientInfo` and Session identifiers are retained only as
untrusted observation evidence and never change authorization. Results provide
validated structured content plus equivalent compact JSON text. Structured
actions carry stable identities, timing, reason codes, required capabilities,
and executable arguments.

Project-aware workflows use one Runtime-owned identity resolver. The Runtime
returns canonical project identity, confidence, and warnings; ambiguous or
conflicting evidence does not cause a guessed project selection. Repository
paths compare as complete identities rather than by leaf name: Windows-style
paths use Windows case semantics, while POSIX-style paths remain case-sensitive.
An uncertain project Recall or project-history request returns no note excerpts;
it exposes only bounded candidate metadata and an explicit recovery action. A
started task stores its resolved identity, and later context or closeout input
cannot silently change it.

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

Client-native OAuth/MCP entries keep the endpoint, command, authorization URL,
and redirect URI credential-free. OAuth clients receive their integration's
Bearer only from the token endpoint; manual Bearer clients receive plaintext
only in the explicit current modal. The same modal may construct a complete
common MCP JSON object containing that plaintext for an explicit copy action;
the object is not persisted and disappears when the modal closes. Tracekeeper's
normal flow does not read or write operating-system-specific Agent configuration
paths.

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
- Production Agent access binds exact `127.0.0.1` and requires a valid
  per-integration Bearer on every MCP resource request.
- OAuth discovery, authorization, and token delivery remain exact-loopback only;
  their public routes cannot dispatch MCP tools.
- Successful requests use the fixed `local-user` capability set; client claims
  never create a separate authorization profile, and Sessions cannot cross
  integration or credential bindings.
- MCP cannot read outside the active Vault or inside its Obsidian configuration.
- Agent guidance cannot expand Runtime permissions.
- Global durable memory remains review-gated by default.
- Wiki changes use an independent user-selected rule; task-batch review is the
  default, public MCP cannot approve pending proposals, and auto-managed writes
  are restricted to create-only notes or intact managed relation regions.
- MemoryRecord v2 preserves claim identity, authority, confidence, evidence,
  and current/history/conflict lifecycle projections without overwriting
  history.
- Typed Source index notes own bounded part manifests; Source parts never
  become independent relation targets or top-level Recall matches.
- Automatic and approved writes are attributable and recoverable in proportion
  to their risk.
- Compatibility code may read old layouts, but new content uses the current
  three-root architecture.
