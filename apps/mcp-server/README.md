# Tracekeeper MCP Server

This workspace implements Tracekeeper's Streamable HTTP MCP runtime and public tool handlers. Production is hosted by the desktop Obsidian plugin; the standalone command is for local development and smoke tests.

Shared contracts:

- [System architecture](../../docs/architecture/INDEX.md)
- [Agent Workflow](../../docs/features/AGENT_WORKFLOW.md)
- [Trust boundaries](../../docs/architecture/TRUST_BOUNDARIES.md)

## Protocol Surface

The runtime supports MCP `2025-06-18` and `2025-11-25` over Streamable HTTP. It implements `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, and `prompts/get`. After initialization, clients send the negotiated `Mcp-Protocol-Version` with each session request. `tools/list` exposes the fixed local-user capability surface, while call dispatch repeats the same capability check. Compatibility handlers remain available for older callers but are not advertised as workflow choices.

## Security Posture

- read-only by default, with bounded writes to allowlisted Tracekeeper vault paths
- review-gated durable writeback and user-controlled append-only project memory
- active-vault containment and Obsidian configuration-directory exclusion
- the active Vault root is server-managed; `tools/call` cannot select or override it
- no shell or network capabilities exposed through tools
- exact `127.0.0.1` binding with no remote-listen mode
- one explicit standalone Bearer required on every non-preflight request; the Obsidian-hosted runtime uses one credential per Agent integration
- fixed local-user capabilities; client self-identification cannot change permissions
- Token-free endpoint URLs; legacy Token query parameters and plaintext Token CLI options are rejected
- Obsidian/loopback CORS allowlist rather than wildcard origins
- sanitized audit events for write operations

The canonical permission and review invariants live in the [trust boundaries](../../docs/architecture/TRUST_BOUNDARIES.md); do not create a second matrix here.

## Local Development

```bash
cd <repo>/apps/mcp-server
npm install --cache /private/tmp/tracekeeper-npm-cache
npm run typecheck
npm run build
npm run test
export TRACEKEEPER_STANDALONE_BEARER='<32-byte-base64url-bearer>'
node dist/server.js --vault-root <vault> --vault-config-dir <config-dir> --port 51601
```

The endpoint is `http://127.0.0.1:51601/mcp` by default. The standalone runtime reads its Bearer only from `TRACEKEEPER_STANDALONE_BEARER`, fails closed when the value is missing or invalid, and never accepts a plaintext `--token` argument. Clients send the credential as `Authorization: Bearer <token>`; the endpoint URL stays free of secrets. The standalone runtime uses the same explicit local-trust mode as the Obsidian-hosted runtime and refuses any bind address other than `127.0.0.1`.

## Package Scripts

```bash
npm run typecheck
npm run build
npm run test
npm run smoke
```

The smoke suite uses a temporary Vault fixture and loopback HTTP. It covers the standalone environment-only credential contract, Bearer enforcement and redaction, local-trust migration rejection, origins, sessions, both protocol versions, the fixed capability-filtered tools/resources/prompts, output schemas, structured actions, instruction isolation, scoped recall, safe reads, bounded writes, task closeout, source requests, and exclusion of human review/apply tools.
