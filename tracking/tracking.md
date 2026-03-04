# Obsidian Jarvis UI — Phase & Version Tracking

> Versioning follows **Semantic Versioning (SemVer)**:
> - Features / new capabilities → bump **MINOR** (v1.**X**.0)
> - Bug fixes / polish → bump **PATCH** (v1.0.**X**)
> - Breaking changes → bump **MAJOR** (**X**.0.0)
>
> Run `bash tracking/bump-version.sh` after commits to auto-tag.

---

## v1.2.8 — 2026-03-04 · Phase 7 — Interaction & Layout Enhancements

**Commits:** `98c9115`, `71e3329`, `ef857c8`, `5c6c194`, `3367973`, `178892d`, `88805de`, `5f86e90`, `39cdb12`, `0951f24`

| # | Fix | Commit |
|---|-----|--------|
| P7-1 | Initial load auto-resets camera to bounding-sphere fit | `98c9115` |
| P7-2 | Centre of gravity recalculates on all filter changes (tag + time) | `71e3329` |
| P7-3 | ESC in search bar clears query, removes filter, blurs input | `ef857c8` |
| P7-4 | Note reader width persisted to `jarvis-note-width` localStorage key | `5c6c194` |
| P7-5 | Backlink clicks respect zoom-to-node toggle (no flyTo when OFF) | `3367973` |
| P7-6 | Max node size slider cap=10× min=1×; node size slider min=1× | `178892d` |
| P7-7 | Slider labels renamed: "Node Size" and "Supernode Size" | `88805de` |
| P7-8 | Right-click drag moves closest node + connected neighbours as rigid cluster | `5f86e90` |
| P7-9 | H key focus mode: hide all except selected + connected; HUD breadcrumb | `39cdb12` |
| P7-10 | Orphan ring pattern (Jupiter's rings); orphanPattern setting in Settings | `0951f24` |

---

## v1.2.2 — 2026-03-04 · Hotfixes & Infrastructure

**Commits:** `370cd97`, `aa2f81b`, `038d432`, `079401d`, `a61e720`, `f3a93d3`

| # | Fix | Commit |
|---|-----|--------|
| HF-1 | Remove hardcoded vault path — use `os.homedir()` + `VAULT_PATH` env | `370cd97` |
| HF-2 | Gitignore `memory/`, `PRD.md`, `docs/` — purged from all history | `aa2f81b` |
| HF-3 | Walk symlinked directories (vault `research/` symlink was invisible) | `038d432` |
| HF-4 | Rename `↺ POS` button to `[ Reset View ]` | `079401d` |
| HF-5 | Selected node keeps folder colour — white node caused bloom bleed | `a61e720` |
| HF-6 | Edge bloom only on connected edges; default style unchanged | `f3a93d3` |

---

## v1.2.1 — 2026-03-04 · Phase 6 — Visual Polish & Docs

**Commits:** `6efe7ee`, `c319b8c`, `fe86fd2`, `e53a5d6`, `f41920`, `8626b13`, `7090570`, `9944d55`, `40a667`, `a52935e`

| # | Feature/Fix | Commit |
|---|-------------|--------|
| P6-1 | README with features, setup, keyboard shortcuts, config, changelog | `6efe7ee` |
| P6-2 | Same-folder orphan nodes attract via weak colour-affinity force | `c319b8c` |
| P6-3 | Zoom-to-node toggle in settings (default ON, localStorage) | `fe86fd2` |
| P6-4 | Default spread=1.5×, max node size=3×; RESET ALL uses same defaults | `e53a5d6` |
| P6-5 | Selected node edges bloom cyan, unconnected edges dim | `f41920` |
| P6-6 | Fly-to lands 3× further from node (159 units) for comfortable framing | `8626b13` |
| P6-7 | Recalculate simulation centre of gravity on filter change | `7090570` |
| P6-8 | `[ ↺ POS ]` camera-reset in Settings under RESET ALL; MAX button removed from HUD | `9944d55` |
| P6-9 | 10× more stars (2000) + 3 galaxy backdrop sprites (additive blending) | `40a667` |
| P6-10 | Settings panel vertically centred on left side, dropdown opens right | `a52935e` |

---

## v1.2.0 — 2026-03-04 · Phase 5 — Power Features

**Commits:** `fe201a4`, `9e0521e`, `78b9972`, `9501f8b`, `b8aef7d`, `4b7862`, `a1f312a`, `631ed1`, `91c3cd`, `48ca09`, `4af2a2`, `5dac8d`

| # | Feature | Commit |
|---|---------|--------|
| P5-1 | Max zoom clamped to bounding sphere fit distance | `b8aef7d` |
| P5-2 | MAX zoom-out HUD button snaps to bounding sphere | `9501f8b` |
| P5-3 | Hidden nodes (tag/time filter) excluded from raycasting | `a1f312a` |
| P5-4 | Labels toggle shows title above all visible nodes | `78b9972` |
| P5-5 | 3D wireframe bracket + floating title on open note | `9e0521e` |
| P5-6 | Search bar always visible, never hidden | `48ca09` |
| P5-7 | Tag filter row in search results for `#tag` queries | `91c3cd` |
| P5-8 | Max node size slider cap increased to 5× | `5dac8d` |
| P5-9 | 3× closer zoom in via explicit `minDistance` | `4b7862` |
| P5-10 | Internal wikilinks in open notes navigate graph | `631ed1` |
| P5-11 | Settings panel moved to left side of screen | `4af2a2` |
| P5-12 | flyTo flies 3× closer — 53 units from node | `fe201a4` |

---

## v1.1.2 — 2026-03-04 · Phase 4 — Interaction Fixes

**Commits:** `3e4639`, `ad9df7`, `cb78ae`, `2377a6`, `26e181`, `8b624a`, `79e508`, `663c6a`, `6cc16a`, `6a79af`, `4a6100`, `af8e63`

| # | Fix | Commit |
|---|-----|--------|
| P4-1 | 120fps — uncap `setPixelRatio` to `devicePixelRatio` | `3e4639` |
| P4-2 | Scroll zoom anchors to mouse cursor position | `ad9df7` |
| P4-3 | Tag click in note sidebar triggers tag isolation filter | `cb78ae` |
| P4-4 | SPREAD slider max=10×, display as multiplier | `2377a6` |
| P4-5 | Collapse shows only cluster centre (highest-degree node per folder) | `26e181` |
| P4-6 | Distinguish click from drag — 5px threshold | `8b624a` |
| P4-7 | RESET ALL moved to Settings bottom; resets camera+sliders+sim+filters | `79e508` |
| P4-8 | Pull isolated sub-clusters toward origin (union-find detection) | `663c6a` |
| P4-9 | FlyTo stops 160px back on node select | `6cc16a` |
| P4-10 | Cap min node size slider to 2× | `6a79af` |
| P4-11 | Keyboard arrow navigation through folder siblings + HUD breadcrumb | `4a6100` |
| P4-12 | Sidebar drag-handle resize (280–800px), persisted to localStorage | `af8e63` |

---

## v1.1.1 — 2026-03-04 · Phase 3 — UX Fixes

**Commits:** `60653d`, `deff98e`, `7b299a`, `04afffa`, `2b4f03`, `4c03b8`, `71cd06`, `0c9d79`, `ce552f`

| # | Fix | Commit |
|---|-----|--------|
| P3-1 | Reset camera fits all nodes using bounding box centroid + 10% padding | `04afffa` |
| P3-2 | Orphan nodes (degree=0) gravitate toward global centroid | `deff98e` |
| P3-3 | Cap max node size slider to 2× base radius | `0c9d79` |
| P3-4 | Solid cyan annotation line from cursor to closest proximity node | `7b299a` |
| P3-5 | Settings + shortcuts panel open by default, persisted | `ce552f` |
| P3-6 | Shift+[ collapses all nodes to root cluster | `71cd06` |
| P3-7 | Right-click node flashes visual feedback on toggle | `4c03b8` |
| P3-8 | Left click anywhere opens proximity-previewed note | `2b4f03` |
| P3-9 | Lint fix: extract orphanForce variable | `60653d` |

---

## v1.1.0 — 2026-03-04 · Phase 2 — 9 UI Enhancements

**Commit:** `a207148`

| # | Feature |
|---|---------|
| P2-1 | Stars background toggle |
| P2-2 | Reset camera button |
| P2-3 | Single-click opens full note |
| P2-4 | Proximity cursor auto-preview |
| P2-5 | SPREAD slider (100–300%) |
| P2-6 | Shortcut tooltips |
| P2-7 | Node size by degree |
| P2-8 | Floating node labels |
| P2-9 | Tag filter isolation |

---

## v1.0.0 — 2026-03-04 · Phase 1 — Initial Build ✨

**Commit:** `4cef3bf`  
**Build time:** 16 minutes  
**Files:** 29 · **Vault nodes:** 487 · **Links:** 379

| # | Feature |
|---|---------|
| P1-1 | WebGL renderer (Three.js) with WebGPU fallback |
| P1-2 | Force-directed 3D graph layout |
| P1-3 | Vault parser — reads all `.md` files recursively |
| P1-4 | Wikilink edge detection |
| P1-5 | Folder-based node colouring |
| P1-6 | Node size by backlink degree |
| P1-7 | Sidebar note viewer |
| P1-8 | Search / filter |
| P1-9 | Stars background (Iron Man aesthetic) |
| P1-10 | Settings panel |

---

## Planned

| Version | Description | Status |
|---------|-------------|--------|
| v1.3.0 | Semantic clustering via embeddings (user-supplied API key) | 💤 Queued |
| v1.4.0 | Open-source release prep (vault-path first-run prompt, demo GIF) | 💤 Queued |
| v1.4.1 | Obsidian community plugin submission | 💤 Queued |
