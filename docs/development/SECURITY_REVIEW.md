# Security Review

Changes require focused security review when they affect:

- Vault root resolution, path normalization, symlink handling, or protected
  configuration paths;
- service credential generation, storage, reset, Bearer validation, OAuth
  discovery, dynamic registration, pairing, PKCE, redirect/resource validation,
  query credential rejection, Host or Origin validation, bind address,
  sessions, `clientInfo` observation, request limits, or protocol negotiation;
- any new read, write, external-network, or subprocess target;
- fixed capability classification, discovery filtering, or dispatch
  authorization;
- Knowledge Change Review state transitions or durable writeback;
- client configuration parsing, merge, removal, backup, or replacement;
- Skill bundle identity, target resolution, installation, backup, rollback, or
  update ownership;
- operation journals, recovery, audit payloads, redaction, or error reporting.

## Required Evidence

The review must identify:

1. the fixed `local-user` execution domain and all untrusted client, Session,
   protocol, and content inputs involved;
2. all Vault and Vault-outside targets;
3. the route and validation order: `Host`/`Origin`, public OAuth route
   classification, valid preflight handling, service Bearer for MCP resource
   requests, protocol and Session validation, then tool capability and input
   validation;
4. failure, retry, conflict, and recovery semantics;
5. audit fields and proof that pairing codes and hashes, authorization codes,
   token responses, the service credential and hash, and the `Authorization`
   Header are redacted;
6. focused tests for rejection paths and zero unintended side effects.

Client interoperability exceptions must remain narrow and must not relax
loopback, redirect, resource, PKCE, or Bearer enforcement. The current Codex
callback relay compatibility advertises that the authorization-response `iss`
parameter is not required, while Tracekeeper still returns a matching `iss` in
the redirect and tests that value.

Use temporary Vaults and client fixtures. Do not test a write path against a real
user Vault without explicit authorization.

Any proposal to add remote services, non-loopback HTTP OAuth, hosted OAuth,
shell execution, unrestricted Vault-outside access, or automatic global durable
writes changes the product trust model. It requires explicit product and
architecture decisions before implementation.

The enforced runtime and data boundaries are defined in
[Trust Boundaries](../architecture/TRUST_BOUNDARIES.md).
