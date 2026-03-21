# Changelog

## v2.15.0 — Performance & UX Overhaul (2026-03-22)

### Loading UX
- Multi-phase loading progress bar: graph build → embedding indexing with live progress
- Event loop yield during embedding build so status API stays responsive
- Graph renders immediately when ready — no longer blocked on embedding completion
- Fixed hot-start black screen (cached embeddings race condition)

### Visual
- **Stars**: spherical distribution surrounding scene from all directions, 3 brightness tiers (dim/medium/bright)
- **Bloom slider**: range 0.0–3.0 (was toggle). Click label to toggle on/off. Preset backward compat
- Default labels off

### Performance
- **Position interpolation (lerp)**: 60fps smooth motion decoupled from 3fps sim ticks. Render loop lerps displayed positions toward targets continuously
- **Half-resolution bloom**: UnrealBloomPass at canvas/2, 4× less fill rate
- **3 mip levels** (was 5): fewer blur passes
- **Bloom pass disabled when strength=0**: skips entire pipeline
- Removed bloom profiling double-render that caused visible flash

### Fixes
- Search bar click-to-close: `pointerdown` capture phase works with Three.js canvas
- Guard all `graphData.nodes/links` access with optional chaining (crash fix)

### Dev Tools
- Perf HUD (`?perf` flag): Render FPS, Sim FPS, frame time, bloom Δ, worker→main latency, movement convergence

## Phase 7 — Interaction & Layout Enhancements (v1.2.8)
- Initial load auto-resets camera to bounding-sphere fit (same as Reset View)
- Centre of gravity recalculates on ALL filter changes (tag, time, search)
- ESC in search bar clears query, removes dim-filter, and blurs input
- Note reader panel width persisted to `jarvis-note-width` localStorage key
- Backlink clicks in note sidebar respect the Zoom-to-Node toggle (no flyTo when OFF)
- Max node size slider: cap raised to 10×, minimum raised to 1× (no longer below base)
- Slider labels renamed: "Node Size" and "Supernode Size"
- Right-click drag: moves closest node + all connected neighbours as a rigid cluster; brightness boost during drag; browser context menu suppressed
- `H` key: focus mode — hides all nodes except selected + direct neighbours; HUD shows `[H] FOCUS MODE`; ESC exits
- Orphan ring pattern: degree-0 nodes arranged in concentric horizontal rings around the centroid (Saturn's rings aesthetic); switchable to centroid (folder clustering) mode via Settings dropdown; persisted to `jarvis-orphan-pattern`

## Phase 6 — Visual Polish & Docs (v1.2.1)
Menu centred vertically, 10x stars (2000) + 3 galaxy backdrops, camera-reset `[ Reset View ]` button in settings panel, dynamic centre of gravity shifts to filtered nodes, fly-to lands 3x further for comfortable framing, connected edges bloom cyan on node selection, default spread 1.5x / max size 3x, zoom-to-node toggle (default ON), orphan nodes group by folder colour, HUD buttons moved to settings panel.

## Phase 5 — Power Features (v1.2.0)
Max zoom clamped to bounding sphere, zoom-out button, hidden nodes excluded from raycasting and proximity, labels toggle shows all visible nodes, 3D wireframe bracket on open note, search bar always visible, tag filter row in search results, max node size 5x, 3x closer zoom in, internal wikilink navigation, settings panel moved to left side.

## Phase 4 — Interaction Fixes (v1.1.2)
Sub-cluster pull toward origin, RESET ALL button, click-vs-drag distinction, SPREAD slider 10x max with multiplier display, tag click in sidebar triggers tag isolation, scroll zoom anchors to mouse cursor, 120fps via uncapped pixel ratio.

## Phase 3 — UX Fixes (v1.1.1)
Settings panel, resizable sidebar, orphan node radial pull, annotation line to proximity node, keyboard navigation (arrow keys), click-to-open note in sidebar, folder collapse/expand.

## Phase 2 — UI Enhancements (v1.1.0)
Star field, reset camera to fit, proximity hover with tooltip, SPREAD slider, node size by degree, floating label sprites above nodes.

## Phase 1 — Initial Build (v1.0.0)
3D force-directed graph, bloom post-processing, folder colour coding, search bar, tag filter, time filter slider.
