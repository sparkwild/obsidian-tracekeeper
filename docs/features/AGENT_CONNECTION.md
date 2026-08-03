# Agent Connection

Tracekeeper connects local MCP clients to the active Obsidian Vault through one
loopback-only Runtime. Agent integrations are durable settings records; Skill
files and MCP credentials are separate lifecycles.

## Setup flow

1. Start the MCP Runtime. It binds only to the exact
   `http://127.0.0.1:<port>/mcp` endpoint.
2. In **Agent Configuration**, choose **Add Agent**. The selected client gets
   one persistent card immediately, before configuration, authorization, or
   use.
3. Copy the client-native setup command with an explicit button. Copying only
   records `copied_unverified`; it never edits client files or proves contact.
4. OAuth-capable clients use the default OAuth mode. The client discovers the
   protected-resource and authorization-server metadata, uses Authorization
   Code + PKCE S256 and RFC 8707 `resource`, and opens a browser waiting page.
   Obsidian shows the pending request and the user explicitly chooses Allow or
   Deny for the selected integration. The browser never approves access.
5. Clients that cannot safely complete OAuth may use the explicit manual Bearer
   mode. Tracekeeper persists only a SHA-256 digest; the 256-bit plaintext is
   shown once in the current modal and can be copied explicitly. It is never in
   a URL, command, settings value, log, Vault record, or notification.
6. A successful token exchange changes authorization to `authorized`. A valid
   credential completing `initialize` changes MCP connection to `connected`; a
   successful tool call changes usage to `used`.

The configuration surface never auto-copies, auto-writes client files, hides
technical details behind a wizard, or claims that configuration is verified
before the client reaches the endpoint.

## Independent state axes

Each card renders four independent axes:

- **MCP configuration/connection:** `not_started`, `copied_unverified`,
  `client_reached`, `connected`, `needs_update`.
- **Authorization:** `not_authorized`, `pending_approval`, `authorized`,
  `revoked`.
- **Usage:** `never_used` or `used`, with the latest successful call.
- **Skill:** not installed, installed, update available, externally modified,
  legacy, conflict, or copy-only.

Skill actions never create or alter credentials. Revoking MCP access never
uninstalls Skill files. Forgetting a card requires its credential to be revoked
first and removes only integration metadata.

Changing the Runtime port marks affected cards `needs_update`; it does not
silently revoke credentials. A Skill-only card remains visible when a receipt is
present without an MCP integration, and scanning can recreate that card after an
integration is forgotten.

## Credentials and sessions

Each client profile has at most one integration and each integration has at most
one active credential. OAuth and manual Bearer credentials share the same
constant-time digest verifier, revocation path, Session binding, and audit
fields. Credentials remain valid until replacement or revocation; Tracekeeper
does not issue refresh tokens or advertise expiry.

Every request revalidates the Bearer. A Session is bound to its original
`integrationId`, `credentialId`, and `authMode`; presenting another valid card's
credential on that Session returns `401`. Revocation closes the card's active
Sessions and request-time verification still fails if closure races. Execution
remains `principalId: local-user` with the fixed local capability set; neither
`clientInfo` nor an OAuth client-name claim selects an Agent or grants access.

The plugin also stores a separate `runtimeSecuritySecret` for internal
writeback confirmation. It is not an HTTP credential and is never reused as an
Agent Bearer.

## OAuth approval bridge

OAuth temporary requests, authorization codes, PKCE challenges, and unbound DCR
records stay in memory. A pending request contains only the opaque request
handle, client claim, redirect origin, resource, scope, challenge, and bounded
timestamps. Obsidian's approval view displays the target Agent, the client name
as an explicitly untrusted claim, redirect origin, resource, scope, and expiry.

Allow binds the request to the explicitly selected `integrationId`. The one-time
authorization code is additionally bound to integration, credential, OAuth
client, redirect URI, resource, and PKCE challenge. Token persistence happens
before the response is returned; on persistence failure the old credential stays
valid and the client receives `server_error`. RFC 7009-style revoke accepts
unknown tokens without revealing whether they existed.

The browser waiting/success/error pages are same-origin, `no-store`,
`no-referrer`, CSP-protected, script-free surfaces. They contain no credential,
approval button, or opaque handle beyond the waiting URL required for polling.

## Skill boundary and recovery

The companion Skill teaches `no_track`, `recall_only`, and `tracked_task` habits;
it never grants Runtime permissions or proves MCP use. Skill installation keeps
the existing preview, confirm, backup, rollback, symlink, and receipt controls.

Settings owns connection, authorization, revocation, replacement, forgetting,
and Skill actions. Activity may show recent non-secret integration and
credential identifiers, active Sessions, pending approvals, and latest use, but
historical events without a trusted `integrationId` never create a card.
Activity uses a normalized client type for display grouping only; the
untrusted `clientInfo` and client name never select or authorize a card.

OAuth discovery starts from Protected Resource Metadata and authorization
server metadata, then uses Authorization Code with PKCE `S256` and RFC 8707
`resource` binding.

Single-card revoke affects only that integration. **Revoke all Agent access**
clears every active credential and pending OAuth decision, closes all Sessions,
and preserves cards and Skill files. Runtime startup after migration is allowed
only after the new settings schema and fresh internal secret are durably saved;
the old shared credential and old bootstrap fields are rejected rather than
converted.
