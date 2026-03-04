# Obsidian Jarvis UI

> 3D WebGPU knowledge graph visualizer for Obsidian vaults. Iron Man Jarvis aesthetic.

## Quick Start

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173` — backend API at `http://localhost:3001`.

## Vault

Configured for `~/obsidian/otacon-vault`. Change via:
```bash
VAULT_PATH=/path/to/vault npm run dev
```

## Features

- **3D Force Graph** — WebGPU/WebGL rendering, d3-force-3d simulation in Web Worker
- **Search** — Press `/` to search. Support for `#tag` filtering with autocomplete
- **Navigation** — Click to select, double-click for full note, right-click to expand/collapse
- **Sidebar** — Note viewer with rendered markdown, backlinks, wikilink navigation
- **Electron Animation** — BFS pathfinding with glowing particle traversal
- **Time Filter** — Date range slider with 1D/1W/1M/1Y presets
- **Settings** — Bloom toggle, node opacity slider
- **Folder Colors** — Deterministic color per top-level folder

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Open search |
| `Escape` | Close search / sidebar |
| `]` | Expand all nodes |
| `[` | Collapse leaf nodes |
| Right-click node | Toggle collapse |
