# Security Policy

## Supported Versions

Tracekeeper is currently maintained on the `main` branch.

The technical trust zones, permission classes, and filesystem boundaries are documented in [Trust Boundaries](./docs/architecture/TRUST_BOUNDARIES.md).

## Reporting A Vulnerability

Please do not open a public issue for sensitive security problems.

Instead:

1. Open a private security advisory in GitHub, if available.
2. If that is not available, contact the maintainer through the repository owner account: `https://github.com/sparkwild`.

When reporting, include:

- affected version or commit
- reproduction steps
- expected impact
- whether the issue affects the Obsidian plugin, MCP runtime, client auto-configuration, or vault operations

## Scope Notes

Treat these as security-relevant:

- unintended writes outside the active vault
- client configuration changes without user confirmation
- arbitrary command execution
- unexpected remote data exposure
- permission bypasses around Knowledge Change Review or approved writeback
