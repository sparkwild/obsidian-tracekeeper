# Tracekeeper MCP Server

This workspace implements Tracekeeper's Streamable HTTP MCP runtime and public tool handlers. Production is hosted by the desktop Obsidian plugin; the standalone command is for local development and smoke tests.

Shared contracts:

- [System architecture](../../docs/architecture/INDEX.md)
- [Agent Workflow Contract](../../docs/architecture/AGENT_WORKFLOW_CONTRACT.md)
- [Security and permission model](../../docs/security/INDEX.md)

## Protocol Surface

The runtime supports MCP `2025-06-18` and `2025-11-25` over Streamable HTTP. It implements `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, and `prompts/get`. After initialization, clients send the negotiated `Mcp-Protocol-Version` with each session request. `tools/list` exposes only the authenticated principal's permitted focused surface, while call dispatch repeats the same capability check. Compatibility handlers remain available for older callers but are not advertised as workflow choices.

## Security Posture

- read-only by default, with bounded writes to allowlisted Tracekeeper vault paths
- review-gated durable writeback and user-controlled append-only project memory
- active-vault containment and Obsidian configuration-directory exclusion
- no shell or network capabilities exposed through tools
- generated local token required by default
- Obsidian/loopback CORS allowlist rather than wildcard origins
- sanitized audit events for write operations

The canonical permission and review invariants live in the [security model](../../docs/security/INDEX.md); do not create a second matrix here.

## Local Development

```bash
cd <repo>/apps/mcp-server
npm install --cache /private/tmp/tracekeeper-npm-cache
npm run typecheck
npm run build
npm run test
node dist/server.js --vault-root <vault> --vault-config-dir <config-dir> --port 58437 --token <token>
```

The endpoint is `http://127.0.0.1:58437/mcp?token=<token>` by default. The standalone runtime refuses to start without a token unless `--allow-missing-token-for-dev` is explicitly supplied for an isolated development check.

## Package Scripts

```bash
npm run typecheck
npm run build
npm run test
npm run smoke
```

The smoke suite uses a temporary non-network vault fixture and covers authentication, origins, sessions, both protocol versions, capability-filtered tools/resources/prompts, output schemas, structured actions, instruction isolation, scoped recall, safe reads, bounded writes, task closeout, source requests, Review Queue flow, and approved writeback.
