# Agent Connection

Tracekeeper connects a local Agent to the active Obsidian Vault through the
Obsidian-hosted MCP Runtime. Setup is recoverable, evidence-driven, and explicit
about which actions the plugin can perform for each client.

## Setup Flow

The target first-run flow is:

1. Check or initialize the Tracekeeper Vault structure.
2. Confirm that the local MCP Runtime is running.
3. Select the Agent client.
4. Preview and apply, or copy, the MCP connection configuration.
5. Install or display the matching Tracekeeper Skill guidance.
6. Reload the client when required.
7. Verify connection and permissions.
8. Observe one non-empty project-scoped Recall by the selected client principal.
9. For a workflow-capable client, observe one same-principal
   `start -> recall -> finish` sequence.

A selected principal without `workflow.manage` follows the supported
Recall-only path. The UI must state that tracked closeout is unavailable and
must not ask that principal to call lifecycle tools.

The plugin persists progress so the user can leave and resume the flow. The
first incomplete setup may show one native Obsidian entry prompt with only
**Start connecting Agent** and **Set up later**. Opening or dismissing that
prompt does not configure a client, install a Skill, or write knowledge.

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

Automatic client-configuration or Skill installation is available only for
clients with a verified local placement contract. Other clients receive
copyable configuration or flattened Skill guidance with honest manual steps.

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

The normal Activity and connection-status surfaces show MCP service availability
separately from authenticated Agent evidence. Recent evidence is identified by a
client-facing label and last-observed time from the local audit; it is not
presented as proof that the client remains online. Selected or configured clients
with no authenticated-call evidence remain explicitly unverified.

Activity exposes at most one visually dominant next action. Structure repair and
Runtime recovery take priority over incomplete onboarding, actionable knowledge
changes, and observed workflow failures. The latest task, knowledge-change state,
and source activity remain visible before the advanced diagnostics section.
Principal identifiers, lifecycle ratios, latency percentiles, evaluator commands,
and aggregate counters are collapsed by default. These diagnostics use only
locally observed calls, do not measure missed calls, and are never uploaded.
