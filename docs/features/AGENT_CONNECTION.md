# Agent Connection

Tracekeeper connects a local Agent to the active Obsidian Vault through the
Obsidian-hosted MCP Runtime. Setup is recoverable, evidence-driven, and explicit
about which actions the plugin can perform for each client.

## Setup Flow

First-run setup is distributed across the settings modules that own each
decision:

- **MCP Service** owns Runtime state, connection details, and the read-only
  public-tool viewer.
- **Agent Configuration** owns one Add Agent flow plus each established
  client's connection management, recent-use evidence, and compact Skill
  status and action.
- **Memory Rules** owns the review and persistence policy.

The normal settings page does not retain a separate onboarding checklist or
evidence dashboard. The first incomplete setup may show one native Obsidian
entry prompt with only **Start connecting Agent** and **Set up later**. Starting
from that prompt opens the relevant settings; dismissing it does not configure
a client, install a Skill, or write knowledge.

The complete connection outcome still requires:

1. A ready Tracekeeper Vault structure and running local MCP Runtime.
2. One Agent selected from the outer **Add Agent** menu.
3. For a client with verified local OAuth support, the modal's **Start
   connection** action issues a short-lived pairing code and copies only the
   official client command containing the public loopback endpoint. The user
   runs that command and types the code by hand on Tracekeeper's local
   authorization page. Other clients receive an honest native-settings or
   manual fallback.
4. Client-native credential storage and a reload or reconnect when required.
5. One external Streamable HTTP Session that successfully initializes with the
   installation-level service Bearer and completes at least one Tracekeeper
   tool call.
6. A non-empty project-scoped Recall and, when tracked-workflow onboarding
   evidence is required, one `start -> recall -> finish` sequence observed in
   that same external Streamable HTTP Session.

The local Tracekeeper authorization page uses the current Tracekeeper plugin
language: Chinese locales render a complete Chinese page and all other locales
render English. The browser's language preference cannot override that choice;
the browser only controls the page's light or dark appearance. The page is a
local, development-defined surface with no user CSS or theme setting. The final
redirected callback page remains owned by the Agent client.

The same Agent surface recommends the companion usage guide after authorization
and offers its independent preview-and-confirm installation flow where
supported. Guide installation is optional, does not add access permissions,
is not connection authentication, and does not complete the protocol-use gate.

The add modal shows one primary next action at a time. Raw commands, OAuth/PKCE
terms, versions, and hashes remain in collapsed technical details. Manage mode
stays compact until the user chooses to reconnect; connection completion and
guide adoption remain separate evidence.

The Runtime exposes one fixed capability set to every successfully authenticated
request. Client configuration does not select a Recall-only or workflow profile,
and client-reported identity does not change authorization.

Tracekeeper may retain this evidence for verification and recovery, but the
normal settings surface does not expose it as a permanent step tracker. Each
module reports only the operational state it owns.

Onboarding evidence and completion do not control resident Agent-card
visibility; Agent Configuration applies the separate protocol-use gate below.

The outer **Add Agent** control opens the current candidate menu. Choosing one
candidate opens a modal already scoped to that Agent; the modal does not contain
a second Agent selector. This keeps candidate selection and one Agent's
connection actions in separate interaction levels.

## Evidence States

The UI treats these as independent evidence:

- the Skill bundle is available;
- guidance was copied;
- the user confirmed a manual step;
- managed Skill files match the expected hashes;
- the client was reloaded;
- a pairing code is ready, consumed, expired, or invalidated;
- the client's OAuth flow completed;
- an external Session initialized with the current service credential;
- that same Session completed a Tracekeeper tool call;
- an external `tracekeeper.recall` returned at least one match;
- a complete tracked workflow was observed when required by onboarding;
- an update is available.

A plugin-local Recall preview cannot complete external Recall verification. File
verification does not prove that a client discovered or automatically used the
Skill, and one Recall does not prove automatic Skill triggering.

## Service Access And Fixed Capabilities

All configured clients use the same installation-level service Bearer. The
Bearer protects access to the local service; it is not a client identity or an
authorization profile. Every successful request runs in the fixed `local-user`
execution domain with `vault.read`, `workflow.manage`, `vault.write`, and
`memory.propose`. Review/apply separation, Vault path validation, Memory rules,
and other operation-specific policy remain enforced after that fixed capability
check.

MCP `clientInfo` and Session identifiers are self-reported or transport-level
observation data. They can label recent use and help diagnosis, but they cannot
grant capabilities, create a separate Principal, or prove which executable sent
a request. Tracekeeper therefore does not offer per-client capability profiles
or per-client server-side revocation.

Tracekeeper delivers that existing service Bearer through the MCP authorization
flow rather than exposing it as connection configuration. An unauthenticated MCP
request receives Protected Resource Metadata discovery; the same exact-loopback
Runtime publishes Authorization Server Metadata, public-client registration,
authorization-code and token endpoints. The authorization request and token
exchange require PKCE `S256`, an exact registered loopback redirect URI, and the
MCP resource indicator.

The pairing code is a short-lived human confirmation generated inside Obsidian.
It is submitted only in the local authorization form body and is never part of
the MCP URL, authorization URL, redirect URI, terminal command, AI instruction,
Deep Link, log, audit record, or client configuration. Pairing codes,
registrations, and authorization codes are memory-only and are invalidated by
Runtime restart, port change, plugin unload, or global credential reset.

The token endpoint returns the one installation-level Bearer as an opaque access
token. The client owns secure credential storage. Tracekeeper does not create
per-client access or refresh tokens, and successful OAuth login still does not
prove which executable sent later requests.

The normal Agent Configuration card does not enumerate MCP tools or expose a
capability-preset selector. Tool discovery belongs to the MCP Service
**View capabilities** surface; authorization remains enforced by the Runtime.

Agent Configuration is one unified surface. Its normal list shows a client type
only after the same external Streamable HTTP Session has completed both a
successful MCP initialization and at least one successful Tracekeeper
`tools/call`. Evidence from different Sessions or the plugin-internal direct
transport cannot be combined.

A verified official status entry may suppress a client whose configuration was
clearly removed. Tracekeeper does not scan operating-system-specific
configuration paths as the normal visibility gate. Pairing-only, OAuth-login-only,
initialize-only, removed, and unused clients do not create a resident Agent
card; those client candidates remain in **Add Agent**.

The supported candidate set includes Codex, Claude Code, Claude Desktop,
Cursor, Gemini CLI, Grok Build, ZCode, and a Custom MCP fallback. Each candidate
exposes only a compatibility-proven OAuth/CLI/link/extension/settings action or
an explicit fallback. The normal flow neither detects nor writes cross-platform
client configuration paths, and it never hands the Bearer or complete
Authorization Header to the user or an Agent.

The current registry exposes the official OAuth CLI path for Codex, Claude Code,
and Gemini CLI. Codex compatibility is covered by a live native-client probe;
the generated command relies on MCP discovery and therefore does not add a
second explicit resource parameter. Claude Desktop, Cursor, Grok Build, ZCode,
and Custom MCP retain their documented native or manual fallback until an
equivalent local OAuth path is proved.

Each visible Agent card keeps the client-facing identity, recent connection and
successful-use evidence, connection management, and Skill state together. MCP
Service does not duplicate the Agent list or expose a separate connection-setup
entry.

OAuth connection and Skill installation use separate capability registries.
Clients without verified local OAuth receive honest native/manual connection
guidance. Managed Skill installation is available only for clients with a
verified local placement contract; other clients receive flattened Skill
guidance.

Each Agent card shows one state-aware Skill row. Verified installs remain quiet;
missing, outdated, or legacy installs expose only the applicable install, update,
or migrate action. Local modifications, newer versions, and directory conflicts
are preserved and do not expose an unsafe overwrite or downgrade action.

Managed Skill installation always uses preview, explicit confirmation,
current-file revalidation, physical-path symlink rejection, backup, and conflict
detection. A committed bundle followed by a receipt or audit failure is shown as
partial, never as an unchanged target. File verification proves bundle identity,
not client loading or Agent adoption. Client connection configuration is owned
by the client's official entry. The complete filesystem and credential controls
are defined by the [knowledge runtime](../architecture/KNOWLEDGE_RUNTIME.md) and
[trust boundaries](../architecture/TRUST_BOUNDARIES.md).

Removing one client through its official entry removes only that configuration.
Advanced global credential reset rotates the installation-level Bearer,
terminates every active Session, and requires every configured client to be
authorized again.

## Recovery And Visibility

Activity, the command palette, and plugin settings expose recovery entry points.
The current screen should state what evidence is missing, which client must
perform the next action, and where the user should return afterward.

Runtime disabled, stopped, transitional, running, port-conflict, and failed
states must remain distinct. A configured client is not described as connected
until a real external Session has both initialized and completed a successful
Tracekeeper tool call.

The dedicated connection-status surface shows MCP service availability separately
from observed usable-Agent evidence. The normal Activity surface does not repeat
service, Vault, Agent, and refresh summaries in a header-card layer. Runtime
failure remains prominent through the single operational action when recovery is
required.

Activity groups recent audit evidence by normalized client type, showing each
client-facing Agent identity with its latest observation and the count of
contributing Sessions. Raw client name/version and Session identifiers remain
advanced diagnostic evidence. Agent rows do not duplicate tool-call or
connection events, and historical evidence is never presented as proof that a
client remains online. Selected, configured, copied, or initialize-only clients
with no successful tool-use evidence stay out of the normal Agent list.

Activity exposes at most one visually dominant next action. Structure repair and
Runtime recovery take priority over actionable knowledge changes and observed
workflow failures. Agent connection, credential, and Skill actions remain in
settings; Activity only provides a compact route there. The latest task,
knowledge-change state, and source activity remain visible before the advanced
diagnostics section. Raw client and Session claims, lifecycle ratios, latency
percentiles, evaluator commands, and aggregate counters are collapsed by
default. These diagnostics use only locally observed calls, do not measure
missed calls, and are never uploaded.

The Activity surface labels its bounded audit preview as recent events. It answers
what happened through a small chronological preview and links to the complete
Runtime log for pagination and diagnosis. Agent activity separately answers which
client-facing identities were recently observed.

The combined Activity timeline keeps a finite window of at most 2,000 records.
Each record category selects one additional candidate through Obsidian metadata
before reading bodies, so rendering never requires an unbounded content parse.
When the limit, missing or stale metadata, filtering, or a read failure prevents
the repository from proving that every controlled record is represented, the
timeline snapshot reports itself as truncated instead of claiming complete
history.
