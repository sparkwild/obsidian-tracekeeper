# Tracekeeper Documentation

This directory keeps the maintained Tracekeeper product and release documentation. Runtime, permission, plugin-surface, and client-configuration notes are consolidated so there is one canonical place to update each topic.

## Current Docs

- [Architecture](./ARCHITECTURE.md): product architecture, plugin surface, MCP permissions, Runtime security, and agent client configuration.
- [Community plugin submission](./COMMUNITY_PLUGIN_SUBMISSION.md): Obsidian community checklist, release creation steps, and submission entry.
- [Development and release notes](./DEVELOPMENT.md): repository layout, verification commands, release readiness, roadmap, and acknowledgement policy.

## Core Boundary

- Agent clients start knowledge work.
- Obsidian is the human review and governance surface.
- The vault is the durable knowledge layer.
- Client connection details use local Runtime defaults that users can change; Tracekeeper does not hardcode vault paths, repository paths, or developer machine paths.
- Graph health checks are configurable, but graph repair remains review-gated and never runs automatically.
