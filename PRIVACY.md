# Privacy Policy

Tracekeeper is local-first. It is designed to work with an Obsidian vault on the user's machine.

For the complete technical trust model, see [Trust Boundaries](./docs/architecture/TRUST_BOUNDARIES.md).

## What Tracekeeper Does

- Reads the active Obsidian vault through Obsidian plugin APIs and the local MCP runtime.
- Writes vault notes only through explicit user actions or controlled MCP tools.
- Keeps important long-term memory changes behind Knowledge Change Review approval.
- Generates a separate internal security secret and stores one digest per Agent integration in local plugin data to protect the loopback MCP Runtime.
- Publishes local OAuth discovery, authorization, token, and revocation endpoints on the same exact-loopback Runtime so supported clients can authorize one selected integration.
- Lets the user preview and explicitly confirm managed Skill changes; normal Agent connection configuration remains client-owned.

## What Tracekeeper Does Not Do By Default

- It does not run a hosted backend.
- It does not upload vault content to a remote service.
- It does not silently capture all conversations.
- It does not assume a fixed vault path, repository path, or local port.

## Data Handling

- Vault content stays on the user's machine unless the user chooses another workflow.
- MCP, authorization, and redirect URLs and client-native commands contain no credential. Supported clients receive only their selected integration's access token from the local OAuth token endpoint and own its subsequent storage.
- Pending approval requests, dynamic client registrations, authorization codes, and PKCE state are short-lived memory state and disappear on expiry, Runtime restart, plugin unload, port change, or global revoke.
- Managed Skill writes require explicit confirmation, use previews, and create backups.
- Tracekeeper does not write plaintext tokens, credential digests, authorization codes, PKCE verifiers, pending handles, token responses, Authorization Headers, or the internal security secret to Vault audit records, Runtime logs, screenshots, or network uploads.
- A connected Agent may send context returned through MCP to a local or remote model. That handling is governed by the Agent and model provider selected by the user, not by Tracekeeper.

## User Responsibility

Users remain responsible for reviewing proposed memory changes, backing up important vaults, protecting client-owned credentials, and controlling which AI tools and model providers are connected.
