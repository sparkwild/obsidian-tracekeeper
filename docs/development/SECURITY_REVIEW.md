# Security Review

Changes require focused security review when they affect:

- Vault root resolution, path normalization, symlink handling, or protected
  configuration paths;
- MCP authentication, Host or Origin validation, bind address, sessions, request
  limits, or protocol negotiation;
- any new read, write, external-network, or subprocess target;
- capability classification, discovery filtering, or dispatch authorization;
- Knowledge Change Review state transitions or durable writeback;
- client configuration parsing, merge, removal, backup, or replacement;
- Skill bundle identity, target resolution, installation, backup, rollback, or
  update ownership;
- operation journals, recovery, audit payloads, redaction, or error reporting.

## Required Evidence

The review must identify:

1. the trusted principal and untrusted input involved;
2. all Vault and Vault-outside targets;
3. the pre-dispatch authorization and validation order;
4. failure, retry, conflict, and recovery semantics;
5. audit fields and redaction;
6. focused tests for rejection paths and zero unintended side effects.

Use temporary Vaults and client fixtures. Do not test a write path against a real
user Vault without explicit authorization.

Any proposal to add remote services, shell execution, unrestricted Vault-outside
access, or automatic global durable writes changes the product trust model. It
requires explicit product and architecture decisions before implementation.

The enforced runtime and data boundaries are defined in
[Trust Boundaries](../architecture/TRUST_BOUNDARIES.md).
