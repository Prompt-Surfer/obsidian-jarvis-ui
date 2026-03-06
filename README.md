# Jarvis UI — 3D Obsidian Vault Graph

> Iron Man-style 3D knowledge graph viewer for Obsidian vaults

Jarvis UI renders your entire Obsidian vault as a living, interactive 3D force-directed graph — nodes float in space, connections bloom with light, and navigation feels like flying through a knowledge system. Built with Three.js, React, and TypeScript.

![Jarvis UI — Brain Shape](./screenshots/jarvis-brain-preview.png)

---

## Graph Shapes

| Shape | Preview |
|-------|---------|
| 🧠 **Brain** — nodes arranged in an anatomical brain mesh | ![Brain](./screenshots/jarvis-brain-preview.png) |
| 🪐 **Saturn** — sphere + tilted ring for orphan nodes | ![Saturn](./screenshots/jarvis-saturn-final.png) |
| 🌌 **Milky Way** — flat 2-arm Archimedean spiral | ![Milky Way](./screenshots/jarvis-milkyway-final.png) |
| ⚛️ **Centroid** — standard force-directed cluster |  |

---

## Features

### Graph & Layout
- **3D force-directed graph** — nodes and links rendered in real-time WebGL with physics simulation
- **Multiple graph shapes** — Brain (mesh-based anatomical), Saturn (sphere + ring), Milky Way (spiral), Centroid
- **Bloom / glow post-processing** — Unreal bloom pass for that cyberpunk HUD aesthetic
- **Folder colour coding** — each folder gets a unique colour; nodes and edges reflect their folder
- **3-tier node sizing** — regular nodes, supernodes (top 15% by degree), and ultranodes (top 2% hub-of-hubs)
- **Semantic ultranode detection** — ultranodes identified by supernode-neighbour ratio, not raw degree alone
- **Star field + galaxy backdrops** — 2000 stars and 3 galaxy sprites for depth (toggle on/off)
- **Orphan node grouping** — degree-0 nodes cluster by folder via affinity force; can display as Saturn's ring

### Navigation & Interaction
- **Search** — always-visible search bar with fuzzy node matching and tag autocomplete
- **Tag filter** — type `#tag` in search to isolate all notes with that tag; click ✕ to clear
- **Tag filter from sidebar** — click any tag in the note view to isolate that tag's nodes
- **Time filter** — timeline slider to show only notes modified within a date range
- **Keyboard navigation** — arrow keys navigate between notes; `/` opens search
- **Fly-to animation** — smooth camera animation to selected node (toggle on/off)
- **Zoom to cursor** — scroll wheel zooms toward mouse position
- **Camera reset** — `[ Reset View ]` snaps camera back to fit all nodes
- **Right-click drag** — hold right-click on a node and drag to move it; connected neighbours follow as a rigid cluster
- **Focus mode** — press `H` to isolate the selected node and its connected neighbours; locks the visible set so clicking other nodes updates the reader without resetting visibility; `ESC` to exit
- **Folder collapse** — double-click to collapse/expand a folder cluster to its centre node
- **Internal wikilink navigation** — clicking `[[wikilinks]]` in the sidebar navigates the graph

### Reader Pane (Phase 8)
- **Obsidian-style note reader** — dark theme matching Obsidian's #1e1e2e palette
- **Table of contents** — "On This Page" section auto-generated from headings; click to jump
- **Callout blocks** — `> [!note]`, `> [!warning]`, `> [!tip]`, etc. rendered with coloured left borders and icons
- **Tag pills** — inline `#tags` rendered as styled pill badges; click to filter graph
- **Wikilinks** — `[[note links]]` rendered as cyan clickable links; navigates the graph on click
- **Backlinks** — bottom of pane shows all notes that link to the current note
- **Breadcrumb trail** — folder path shown at top for context
- **Resizable pane** — drag the left edge to resize; width persisted to localStorage
- **Custom scrollbar** — thin cyan scrollbar with smooth scroll-behavior for TOC anchor jumps

### Settings & Persistence
- **Settings panel** — bloom, stars, labels, opacity, spread, node/supernode/ultranode size sliders
- **Spread slider** — adjusts graph spacing (1×–10×, default 1.5×)
- **Ultranode size slider** — independently scale the top-tier nodes (1×–8×)
- **RESET ALL** — resets camera, filters, sliders, and simulation to defaults
- **localStorage persistence** — all toggle/slider states saved across sessions
- **120fps support** — pixel ratio capped to `devicePixelRatio` for high-refresh displays

---

## Getting Started

```bash
git clone <repo>
cd obsidian-jarvis-ui
npm install

# Set your vault path in .env:
echo "VITE_VAULT_PATH=/path/to/your/obsidian/vault" > .env

npm run dev
```

Then open http://localhost:5173.

> **Note:** `npm run dev` starts both the Vite frontend and the Express API server concurrently. Both must be running — the API server reads your vault `.md` files and serves the graph JSON.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Open / close search bar |
| `ESC` | Close sidebar, dismiss search, clear filters, exit focus mode |
| `←` / `→` | Navigate to previous / next note in same folder |
| `↑` | Jump to cluster centre (highest-degree node in folder) |
| `↓` | Jump to highest-degree neighbour of selected node |
| `H` | Enter focus mode — isolate selected node + connected neighbours |
| `[` | Collapse all folders to their cluster centres |
| `]` | Expand all collapsed folders |

### Mouse Controls

| Action | Result |
|--------|--------|
| Left-click node | Select node, open reader pane |
| Double-click node | Collapse / expand that node's folder |
| Right-click + drag | Move node and its connected neighbours as a rigid cluster |
| Scroll wheel | Zoom toward cursor |

---

## URL Parameters

Override localStorage defaults for testing or sharing specific views:

```
http://localhost:5173?graphShape=brain&ultraNodeSize=8
```

| Parameter | Values | Description |
|-----------|--------|-------------|
| `graphShape` | `brain`, `saturn`, `milkyway`, `centroid` | Override graph shape |
| `ultraNodeSize` | `1.0`–`8.0` | Override ultranode size multiplier |

---

## Configuration

| Variable | Description |
|----------|-------------|
| `VITE_VAULT_PATH` | Absolute path to your Obsidian vault directory *(required)* |

Set in a `.env` file at the project root:

```env
VITE_VAULT_PATH=/home/yourname/Documents/ObsidianVault
```

---

## Tech Stack

- **Three.js** — 3D rendering, InstancedMesh, OrbitControls, EffectComposer/UnrealBloom
- **React + TypeScript** — component architecture, hooks, forwardRef
- **react-markdown + remark-gfm** — Markdown rendering in the reader pane
- **D3 Force 3D** — physics simulation running in a Web Worker
- **Vite** — build tooling and dev server
- **Express** — local API server to read vault `.md` files

---

## Changelog

See [tracking/tracking.md](./tracking/tracking.md) for full version history.

---

## License

MIT
