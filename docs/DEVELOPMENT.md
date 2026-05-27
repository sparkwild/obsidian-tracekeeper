# Development And Release Notes

This page keeps implementation, verification, and release details out of the top-level README.

## Names

- Product: `Tracekeeper`
- Repository: `obsidian-tracekeeper`
- Obsidian plugin id: `tracekeeper`
- Obsidian plugin display name: `Tracekeeper`
- Chinese in-plugin display: `知识库`
- MCP server id/config key: `tracekeeper`
- MCP tool prefix: `tracekeeper.*`
- Initial version: `0.1.0`

## Verify

```bash
cd <repo>
npm run verify
```

Narrower checks are also available:

```bash
npm run typecheck
npm run build
npm run test
npm run package
```

## Repository Layout

```text
obsidian-tracekeeper/
├─ apps/
│  ├─ obsidian-plugin/
│  └─ mcp-server/
├─ packages/
│  └─ core/
├─ docs/
├─ scripts/
└─ package.json
```

## Community Release

Before submitting to the community directory, follow [Community Plugin Submission](./COMMUNITY_PLUGIN_SUBMISSION.md). Short checklist:

- Run `npm run verify`.
- Make the repository public.
- Push a GitHub tag that exactly matches `manifest.json` version.
- Let `.github/workflows/release.yml` create or refresh the release assets.
- Confirm `main.js`, `manifest.json`, and `styles.css` have GitHub artifact attestations.

## Next Work

1. Improve Agent Connections status states and client detection fixtures.
2. Add fixture tests for client config merge and removal.
3. Split large Obsidian plugin UI modules out of `main.ts`.
4. Add local runtime packaging for `tracekeeper-mcp`.
5. Add integration smoke checks for installed local plugin reload.
6. Add visual regression coverage for the Graph Health view.

## Release Readiness

Before public distribution:

- no hardcoded developer paths
- local Runtime defaults are documented and user-overridable
- no stale historical migration docs
- clear privacy/security docs
- repeatable package verification
- tested install and reload flow
- GitHub release assets include `main.js`, `manifest.json`, and `styles.css`
- GitHub release assets are created by the release workflow and have artifact attestations
- community metadata passes `npm run community:check`

## Acknowledgement Policy

- GitHub contributor credit is reserved for direct code, documentation, design, or issue contributions.
- AI tools used during development may be listed under `Acknowledgements`, not `Contributors`.
- Public writing, demos, or research influences may be acknowledged when the wording avoids endorsement, sponsorship, or direct contribution claims.
