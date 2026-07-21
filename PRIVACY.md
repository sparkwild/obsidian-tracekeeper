# Privacy Policy

Tracekeeper is local-first. It is designed to work with an Obsidian vault on the user's machine.

For the complete technical trust model, see [Security and Privacy Architecture](./docs/security/INDEX.md).

## What Tracekeeper Does

- Reads the active Obsidian vault through Obsidian plugin APIs and the local MCP runtime.
- Writes vault notes only through explicit user actions or controlled MCP tools.
- Keeps important long-term memory changes behind Review Queue approval.
- Reads the supported AI-client configuration locations only to detect the Tracekeeper connection state.
- Lets the user preview and explicitly confirm supported AI-client configuration changes.

## What Tracekeeper Does Not Do By Default

- It does not run a hosted backend.
- It does not upload vault content to a remote service.
- It does not silently capture all conversations.
- It does not assume a fixed vault path, repository path, or local port.

## Data Handling

- Vault content stays on the user's machine unless the user chooses another workflow.
- Client configuration writes require explicit confirmation and create backups.
- Outside the active vault, the plugin limits access to supported client-configuration detection and user-confirmed Tracekeeper connection changes.
- A connected Agent may send context returned through MCP to a local or remote model. That handling is governed by the Agent and model provider selected by the user, not by Tracekeeper.

## User Responsibility

Users remain responsible for reviewing proposed memory changes, backing up important vaults, protecting local connection tokens, and controlling which AI tools and model providers are connected.
