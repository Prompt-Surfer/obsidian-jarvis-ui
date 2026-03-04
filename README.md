# Jarvis UI — 3D Obsidian Vault Graph

> Iron Man-style 3D knowledge graph viewer for Obsidian vaults

Jarvis UI renders your entire Obsidian vault as a living, interactive 3D force-directed graph — nodes float in space, connections bloom with light, and navigation feels like flying through a knowledge system. Built with Three.js, React, and TypeScript.

![Jarvis UI](./docs/screenshot.png)

---

## Features

- **3D force-directed graph** — nodes and links rendered in real-time WebGL with physics simulation
- **Bloom / glow post-processing** — Unreal bloom pass for that cyberpunk HUD aesthetic
- **Folder colour coding** — each folder gets a unique colour; nodes and edges reflect their folder
- **Node size by degree** — highly-connected notes are visually larger
- **Star field + galaxy backdrops** — 2000 stars and 3 galaxy sprites for depth (toggle on/off)
- **Search** — always-visible search bar with fuzzy node matching and tag autocomplete
- **Tag filter** — type `#tag` in search to isolate all notes with that tag; click ✕ to clear
- **Tag filter from sidebar** — click any tag in the note view to isolate that tag's nodes
- **Time filter** — timeline slider to show only notes modified within a date range
- **Labels** — floating node title labels, toggleable, shown for all visible nodes
- **Proximity hover** — nearest node highlighted with annotation line; tooltip on hover
- **Fly-to animation** — smooth camera animation to selected node (toggle on/off)
- **Zoom to cursor** — scroll wheel zooms toward mouse position (OrbitControls)
- **Camera reset** — `[ ↺ POS ]` button snaps camera back to fit all nodes; distinct from RESET ALL
- **Wireframe bracket** — 3D cubic bracket around the currently open note
- **Edge bloom on select** — connected edges glow cyan on node selection; others dim
- **Folder collapse** — double-click or right-click to collapse/expand a folder cluster
- **Orphan node grouping** — degree-0 nodes cluster by folder colour via affinity force
- **Dynamic centre of gravity** — force simulation centroid shifts to filtered nodes only
- **Keyboard navigation** — arrow keys navigate between notes; `/` opens search
- **Internal wikilink navigation** — clicking `[[wikilinks]]` in the sidebar navigates the graph
- **Resizable sidebar** — drag to resize the note preview panel
- **Settings panel** — vertically centred on the left; controls for bloom, stars, labels, opacity, spread, node sizes
- **Spread slider** — adjusts graph spacing from 1x–10x (default 1.5x)
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

> **Note:** The dev server also starts an Express API server (`npm run server`) to read vault files. Both must be running. Use `npm run dev` which starts both concurrently.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Open / close search bar |
| `ESC` | Close sidebar, dismiss search, clear filters |
| `←` / `→` | Navigate to previous / next note in same folder |
| `↑` | Jump to cluster centre (highest-degree node in folder) |
| `↓` | Jump to highest-degree neighbour of selected node |
| `[` | Collapse all folders to their cluster centres |
| `]` | Expand all collapsed folders |
| Right-click node | Toggle collapse/expand for that node's folder |

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_VAULT_PATH` | Absolute path to your Obsidian vault directory | *(required)* |

Set in a `.env` file at the project root:

```env
VITE_VAULT_PATH=/home/yourname/Documents/ObsidianVault
```

---

## Tech Stack

- **Three.js** — 3D rendering, InstancedMesh, OrbitControls, EffectComposer/UnrealBloom
- **React + TypeScript** — component architecture, hooks, forwardRef
- **D3 Force 3D** — physics simulation running in a Web Worker
- **Vite** — build tooling and dev server
- **Express** — local API server to read vault `.md` files

---

## Inspired By

Concept inspired by [@the.poet.engineer](https://instagram.com/the.poet.engineer) for the original gesture-control knowledge graph idea.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for full version history.

---

## License

MIT
