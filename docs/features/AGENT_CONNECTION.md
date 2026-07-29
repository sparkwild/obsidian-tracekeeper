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
2. A selected Agent with a previewed and confirmed, or manually copied,
   connection configuration.
3. Installed or manually saved Tracekeeper Skill guidance.
4. A client reload when required.
5. An authenticated call followed by one non-empty project-scoped Recall.
6. For a workflow-capable client, one same-principal
   `start -> recall -> finish` sequence.

A selected principal without `workflow.manage` follows the supported
Recall-only path. Generated workflow guidance must state that tracked closeout
is unavailable and must not ask that principal to call lifecycle tools.

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
- managed files match the expected hashes;
- the client was reloaded;
- the credential principal connected;
- an external `tracekeeper.recall` returned at least one match;
- a complete tracked workflow was observed when the selected principal has
  `workflow.manage`;
- an update is available.

A plugin-local Recall preview cannot complete external Recall verification. File
verification does not prove that a client discovered or automatically used the
Skill, and one Recall does not prove automatic Skill triggering.

## Client Capabilities

Each managed client receives an independent local credential principal and a
local capability profile. Profiles are presets over Runtime capabilities, not
hosted roles or a second authorization system. Rotating a credential or changing
a profile invalidates only that client's affected evidence.

The normal Agent Configuration card does not enumerate MCP tools or expose a
capability-preset selector. Tool discovery belongs to the MCP Service
**View capabilities** surface; authorization remains enforced by the Runtime.

Agent Configuration is one unified surface. Its normal list shows a client type
only after the same external Streamable HTTP Session has completed both a
successful MCP initialization and at least one successful Tracekeeper
`tools/call`. Evidence from different Sessions or the plugin-internal direct
transport cannot be combined.

A managed client must also be currently detected as `configured`. For a manual
client, successful initialization and tool use in that real protocol Session
are the proof that configuration works. Configured-only, copied-only,
initialize-only, stale managed configurations, and unused clients do not create
a resident Agent card; those client candidates remain in **Add Agent**.

The supported candidate set includes Codex, Claude Code, Claude Desktop,
Cursor, Gemini CLI, Grok Build, ZCode, and a Custom MCP fallback. Gemini CLI,
Grok Build, and ZCode use their native user-level configuration structures and
native Skill directories. Tracekeeper preserves unrelated client settings,
requires the protected Authorization header, and does not treat a written
configuration as successful use.

Each visible Agent card keeps the client-facing identity, recent connection and
successful-use evidence, connection management, and Skill state together. MCP
Service does not duplicate the Agent list or expose a separate connection-setup
entry.

Automatic client-configuration or Skill installation is available only for
clients with a verified local placement contract. Other clients receive
copyable configuration or flattened Skill guidance with honest manual steps.

Each Agent card shows one state-aware Skill row. Verified installs remain quiet;
missing, outdated, or legacy installs expose only the applicable install, update,
or migrate action. Local modifications, newer versions, and directory conflicts
are preserved and do not expose an unsafe overwrite or downgrade action.

Managed installation and configuration always use preview, explicit
confirmation, current-file revalidation, backup, and conflict detection. The
complete filesystem and credential controls are defined by the
[knowledge runtime](../architecture/KNOWLEDGE_RUNTIME.md) and
[trust boundaries](../architecture/TRUST_BOUNDARIES.md).

## Recovery And Visibility

Activity, the command palette, and plugin settings expose recovery entry points.
The current screen should state what evidence is missing, which client must
perform the next action, and where the user should return afterward.

Runtime disabled, stopped, transitional, running, port-conflict, and failed
states must remain distinct. A configured client is not described as connected
until authenticated Runtime evidence exists.

The dedicated connection-status surface shows MCP service availability separately
from authenticated Agent evidence. The normal Activity surface does not repeat
service, Vault, Agent, and refresh summaries in a header-card layer. Runtime
failure remains prominent through the single operational action when recovery is
required.

Activity groups recent audit evidence by credential principal, showing each
client-facing Agent identity with its latest observation and session count. Agent
rows do not duplicate tool-call or connection events. It does not expose principal
or session identifiers in the normal layer, and historical evidence is never
presented as proof that a client remains online. Selected, configured, copied,
or initialize-only clients with no successful tool-use evidence stay out of the
normal Agent list.

Activity exposes at most one visually dominant next action. Structure repair and
Runtime recovery take priority over actionable knowledge changes and observed
workflow failures. Agent connection, credential, and Skill actions remain in
settings; Activity only provides a compact route there. The latest task,
knowledge-change state, and source activity remain visible before the advanced
diagnostics section. Principal identifiers, lifecycle ratios, latency
percentiles, evaluator commands, and aggregate counters are collapsed by
default. These diagnostics use only locally observed calls, do not measure
missed calls, and are never uploaded.

The Activity surface labels its bounded audit preview as recent events. It answers
what happened through a small chronological preview and links to the complete
Runtime log for pagination and diagnosis. Agent activity separately answers which
client-facing identities were recently observed.
