# Privacy Policy

Tracekeeper is local-first. It is designed to work with an Obsidian vault on the user's machine.

For the complete technical trust model, see [Trust Boundaries](./docs/architecture/TRUST_BOUNDARIES.md).

## What Tracekeeper Does

- Reads the active Obsidian vault through Obsidian plugin APIs and the local MCP runtime.
- Writes vault notes only through explicit user actions or controlled MCP tools.
- Keeps important long-term memory changes behind Knowledge Change Review approval.
- Generates and stores one installation-level service credential in local plugin data to protect the loopback MCP Runtime.
- Publishes local OAuth discovery and pairing endpoints on the same exact-loopback Runtime so supported clients can store the installation credential through their own credential mechanism.
- Lets the user preview and explicitly confirm managed Skill changes; normal Agent connection configuration remains client-owned.

## What Tracekeeper Does Not Do By Default

- It does not run a hosted backend.
- It does not upload vault content to a remote service.
- It does not silently capture all conversations.
- It does not assume a fixed vault path, repository path, or local port.

## Data Handling

- Vault content stays on the user's machine unless the user chooses another workflow.
- MCP, authorization, and redirect URLs and client-native commands contain no credential. Supported clients receive the shared service credential only from the local OAuth token endpoint and own its subsequent storage.
- Pairing codes, dynamic client registrations, and authorization codes are short-lived memory state and disappear on expiry, Runtime restart, plugin unload, port change, or global credential reset.
- Managed Skill writes require explicit confirmation, use previews, and create backups.
- Tracekeeper does not write pairing codes or hashes, authorization codes, token responses, the service credential, Authorization Header, or credential hash to Vault audit records, Runtime logs, screenshots, or network uploads.
- A connected Agent may send context returned through MCP to a local or remote model. That handling is governed by the Agent and model provider selected by the user, not by Tracekeeper.

## User Responsibility

Users remain responsible for reviewing proposed memory changes, backing up important vaults, protecting client-owned credentials, and controlling which AI tools and model providers are connected.
