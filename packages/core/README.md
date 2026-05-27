# Tracekeeper Core Runtime

This package implements the shared TypeScript runtime for local Obsidian vault processing.

## Features

- Markdown / frontmatter parsing (`src/markdown.ts`)
- Vault scanning over Markdown notes (`src/scan.ts`)
- Block id, wikilink, claim/evidence callout extraction (`src/markdown.ts`)
- Simple token recall/search (`src/recall.ts`)
- Context pack construction (`src/context-pack.ts`)
- Wikilink graph health metrics (`src/graph-health.ts`)
- Lint preview for:
  - Broken wikilinks
  - Claim blocks without source references
- Vault-root safety helpers (`src/safety.ts`)

## Usage

```ts
import { scanVault, recallNotes, buildContextPack, lintNotes, analyzeGraphHealth } from './src/index';

const scan = scanVault('/path/to/vault');
const recall = recallNotes(scan.notes, 'project memory');
const contextPack = buildContextPack('/path/to/vault', 'project memory');
const lint = lintNotes(scan.vaultRoot, scan.notes);
const graph = analyzeGraphHealth(scan.notes);
```

## Security behavior

- Scan and link resolution are read-only.
- The active Obsidian configuration directory can be skipped when callers provide it.
- Paths are checked to remain inside the configured vault root.

## Verification

```bash
npm run typecheck
npm run build
npm run test
```

`npm run test` runs a local Node smoke script under `scripts/test.mjs` and validates:

- vault root containment rules
- Obsidian configuration directory skip behavior
- symlink-safe scan behavior (skip if supported)
- basic source-analysis output shape
