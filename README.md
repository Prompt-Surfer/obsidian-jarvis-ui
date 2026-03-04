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

### Phase 6
Menu centred vertically, 10x stars (2000) + 3 galaxy backdrops, camera-reset `[ ↺ POS ]` button in settings panel, dynamic centre of gravity shifts to filtered nodes, fly-to lands 3x further for comfortable framing, connected edges bloom cyan on node selection, default spread 1.5x / max size 3x, zoom-to-node toggle (default ON), orphan nodes group by folder colour, HUD buttons moved to settings panel.

### Phase 5
Max zoom clamped to bounding sphere, zoom-out button, hidden nodes excluded from raycasting and proximity, labels toggle shows all visible nodes, 3D wireframe bracket on open note, search bar always visible, tag filter row in search results, max node size 5x, 3x closer zoom in, internal wikilink navigation, settings panel moved to left side.

### Phase 4
Sub-cluster pull toward origin, RESET ALL button, click-vs-drag distinction, SPREAD slider 10x max with multiplier display, tag click in sidebar triggers tag isolation, scroll zoom anchors to mouse cursor, 120fps via uncapped pixel ratio.

### Phase 3
Settings panel, resizable sidebar, orphan node radial pull, annotation line to proximity node, keyboard navigation (arrow keys), click-to-open note in sidebar, folder collapse/expand.

### Phase 2
Star field, reset camera to fit, proximity hover with tooltip, SPREAD slider, node size by degree, floating label sprites above nodes.

### Phase 1
Initial build: 3D force-directed graph, bloom post-processing, folder colour coding, search bar, tag filter, time filter slider.

---

## License

MIT
