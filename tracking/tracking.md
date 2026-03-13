# Obsidian Jarvis UI — Phase & Version Tracking

> Versioning follows **Semantic Versioning (SemVer)**:
> - Features / new capabilities → bump **MINOR** (v1.**X**.0)
> - Bug fixes / polish → bump **PATCH** (v1.0.**X**)
> - Breaking changes → bump **MAJOR** (**X**.0.0)
>
> Run `bash tracking/bump-version.sh` after commits to auto-tag.

---

## v2.11.x — 2026-03-13 · Documentation & Screenshot Pass

| Version | Description | Key Commits |
|---------|-------------|-------------|
| v2.11.3 | Fix video URL — use GitHub release asset (not relative path) | `d12b4b8` |
| v2.11.2 | Redo screenshots with reset view after spread change | `f210f18` |
| v2.11.1 | Update README screenshots + video | `1c51586` |
| v2.11.0 | **feat:** Add 2× and 10× timelapse speed tiers | `1ac15cb` |

---

## v2.10.x — 2026-03-13 · Timelapse Fixes

| Version | Description | Key Commits |
|---------|-------------|-------------|
| v2.10.1 | fix(timelapse): freeze sim during playback; auto-reset on play at end; use createdAt; slow speeds (1d/s, 7d/s, 30d/s) | `ba82107`, `003ad21`, `07e46c9`, `07dda14` |
| v2.10.0 | **feat:** Semantic indexing progress indicator in HUD | `46bbbb7` |

---

## v2.9.0 — 2026-03-13 · Semantic Search Full Integration

| # | Feature | Commit |
|---|---------|--------|
| SS-1 | `~` prefix for semantic search mode in SearchBar | `e7f4711` |
| SS-2 | `/api/semantic-search` + `/api/semantic-status` endpoints | `998b390` |
| SS-3 | Similar Notes section in sidebar | `8276531` |

---

## v2.8.0 — 2026-03-13 · Semantic Search + Presets + Timelapse Init

| # | Feature | Commit |
|---|---------|--------|
| SEM-1 | Local semantic search via `@xenova/transformers` (all-MiniLM-L6-v2) | `3d5a1bd` |
| PRE-1 | Save/load view presets — settings, camera, favourites, filters | `b2e5f8f` |
| PRE-2 | Preset includes time range on save/restore | `e8db83c` |
| TL-0 | fix(timelapse): eliminate setState-during-render warning | `6591941` |

---

## v2.7.0 — 2026-03-13 · Timelapse Animation

| # | Feature | Commit |
|---|---------|--------|
| TL-1 | TimeFilter playback controls — play/pause/reset/speed selector, auto-advance | `656dbea` |
| TL-2 | Node entrance animation — scale + glow burst on reveal | `29bd4ec` |
| TL-3 | Timelapse HUD indicator — pulsing play state + current date | `cbbf9cd` |
| TL-4 | fix(timelapse): v2.7.1 — setState-during-render warning | `6591941` |

---

## v2.6.0 — 2026-03-13 · Content Search

| # | Feature | Commit |
|---|---------|--------|
| CS-1 | Content search results in dropdown — snippets, divider, mark highlight | `cad1042` |
| CS-2 | MiniSearch content index + `GET /api/search/content` endpoint | `6b8dcae` |

---

## v2.5.0 — 2026-03-13 · Full-Text Search

> Intermediate release — content search foundation before v2.6.0 UI integration.

---

## v2.4.0 — 2026-03-13 · First-Run Config + Vault Setup

| # | Feature | Commit |
|---|---------|--------|
| FR-1 | `FirstRunSetup` modal — vault path input, OS detection, validation UX | `ce12bee` |
| FR-2 | Config file + `/api/config` endpoints, OS-aware suggested paths | `28ede2a` |
| FR-3 | Integrate first-run check on mount — blocks graph until configured | `3f74827` |
| FR-4 | Change Vault button — re-opens setup modal from settings | `a322f1f` |

---

## v2.3.x — 2026-03-13 · Tag Boxes Refinements + Centroid Removal

| Version | Description | Key Commits |
|---------|-------------|-------------|
| v2.3.4 | Additive multi-tag filter — merge tags on Enter, × remove per tag | `fc32946` |
| v2.3.3 | Click-outside dismisses results; tag autosuggest on any query; Tab to complete | `b5c91e6` |
| v2.3.2 | R key = Reset View shortcut; defaults: topTags=2, boxSize=2.0× | `9cf8925` |
| v2.3.1 | BOX SIZE slider (0.5×–3.0×) for tag box size scale | `43109c3` |
| v2.3.0 | Venn diagram overlap zones — variable box sizes, spring layout, virtual A∩B boxes | `dc0d264` |

**Also in v2.3.x:**
- Drop Centroid shape — default → Natural, migrate localStorage (`f5545b8`)
- fix: TOP TAGS slider step 4→1, min 4→1 (`8bca36e`)
- fix: empty parent boxes — disable isolatedForce in tagboxes mode (`d25a0e3`)
- fix: orphan cloud — wide 3D spread above grid (`07a433b`)
- test: 26 unit tests for Venn geometry (`de38878`)

---

## v2.2.x — 2026-03-13 · Tag Boxes Visual Polish + Perf

| Version | Description | Key Commits |
|---------|-------------|-------------|
| v2.2.1 | Dirty-flag render gate — skip `composer.render()` when stable; lazy label sprites | `4349be6` |
| v2.2.0 | 3D node scatter in cubes + orphans above grid; large-point galaxy stars; pixelRatio cap 2× | `6aed92b` |

**Also in v2.2.x:**
- feat: Bigger boxes, tag label sprites, top-N slider (`75da2fa`)
- perf(worker): throttle postMessage to every 10th tick when alpha < 0.1 (`8d493b3`)
- fix: wireframe boxes white + additive blending + depthTest:false (`602ffee`)

---

## v2.1.x — 2026-03-13 · Tag Boxes Bugfixes

| Version | Description | Key Commits |
|---------|-------------|-------------|
| v2.1.5 | True cube geometry (zDepth = hs), links toggle, label 2× scale | `f1808c2` |
| v2.1.4 | Wireframe boxes always visible, max contrast | `602ffee` |
| v2.1.3 | Pass node tags to worker — was causing empty tagBoxTargets | `b23ae78` |
| v2.1.2 | Guard worker crash + extend camera reset to 3s | `5f5b42b` |
| v2.1.1 | Fix 4 bugs in tagboxes layout | `141361d` |
| v2.1.0 | **feat:** Force layout + cyan wireframe box rendering for Tag Boxes shape | `66a928d` |

---

## v2.0.x — 2026-03-09 · Phase 10 — Power Features

| Version | Description | Key Commits |
|---------|-------------|-------------|
| v2.0.1 | fix(ui): move settings below SIM STABLE, screenshot below ⚙ | `f360280` |
| v2.0.0 | **Phase 10 complete** | `858bdeb` |

| # | Feature | Commit |
|---|---------|--------|
| EB-1 | Error boundary for Graph3D WebGL failure | `9e3d954` |
| P10-1 | History navigation — Shift+←/→ back/forward through visited notes | `6453daf` |
| P10-2 | Screenshot to clipboard — 📷 button with toast feedback | `8c3149f` |
| P10-3 | Minimap — 2D canvas overlay, always visible, clickable camera pan | `ab703c5` |
| P10-4 | Editor mode — CodeMirror 6 inline editor with 2s auto-save to vault | `0152f42` |
| P10-5 | Tag Boxes shape — 3D Venn diagram of tag relationships | `45452e2` |

---

## v1.10.0 — 2026-03-06 · Phase 9 — Natural + Sun + Favourites

| # | Feature | Commit |
|---|---------|--------|
| P9-1 | Natural shape — gravity-weighted per node tier | `6b43223` |
| P9-2 | The Sun shape — hierarchical 3-shell sphere (ultra/super/regular tiers) | `29912c0` |
| P9-3 | Favourite Notes — F key, heart icon in reader, persistent favourites pane | `e77d0f6` |
| P9-4 | Pattern selector redesign — 2-row grid, larger emoji icons | `a43b7e4` |

---

## v1.9.0 — 2026-03-06 · Phase 8+ Fixes

| # | Fix | Commit |
|---|-----|--------|
| F-1 | Wikilink navigation in reader pane | _(merged)_ |
| F-2 | Focus mode lock improvements | `7d30a2a` |
| F-3 | Semantic ultranode detection | `3eaeb3f` |

---

## v1.8.0 — 2026-03-06 · Brain R3 + Performance

| # | Feature | Commit |
|---|---------|--------|
| BR-1 | Brain mesh R3 — placed on 1,035-vertex mesh (anatomically accurate) | `c7d2602` |
| BR-2 | Brain R2 — compact brainstem, distinct temporal lobes + cerebellum | `0e92799` |
| B-1 | Brain shape initial — 3D anatomical brain silhouette | `bc2b0c0` |
| PERF-1 | Performance pass — RAF buffering, sim ticks −33% | `cf09c86` |
| MW-1 | Milky Way 2-arm Archimedean spiral — zero competing forces, density-gradient disc | `634823a` |
| SAT-1 | Saturn sphere + ring redesign — 40° camera angle, fade edge links | `3be4351` |

---

## v1.7.x — 2026-03-06 · Ultranode Slider + Font + URL Params

| Version | Description | Key Commits |
|---------|-------------|-------------|
| v1.7.1 | fix: improve favourite icon + FAV tab visibility | `33e4cc9` |
| v1.7.0 | 3-tier node sizing (regular/supernode/ultranode) + Ultranode size slider 1×–8× | `0d56a9f` |

**Also:**
- Semantic ultranode detection — hub-of-hubs based on supernode-neighbour ratio (`3eaeb3f`)
- Inter/Segoe UI font for node labels (`9bdbc68`)
- URL param overrides — `?graphShape=brain&ultraNodeSize=8` (`ba0fbfd`)

---

## v1.6.x — 2026-03-06 · Phase 8 — Obsidian Reader Pane

| Version | Description | Key Commits |
|---------|-------------|-------------|
| v1.6.2 | Custom React scrollbar — always-visible cyan, smooth position transition | `01fad0c` |
| v1.6.1 | Smooth scrollbar CSS — 4px thin, transparent track, cyan hover | `4a0aa14` |
| v1.6.0 | **Phase 8 complete** | `5b4ea23` |

| # | Feature | Commit |
|---|---------|--------|
| P8-1 | Obsidian-style note reader pane — dark theme (#1e1e2e), Inter font, full markdown | `5b4ea23` |
| P8-2 | Table of contents — "On This Page", auto-extracted headings, smooth anchor scroll | `5b4ea23` |
| P8-3 | Callout blocks — `[!note]`, `[!warning]`, `[!tip]` with coloured borders + icons | `5b4ea23` |
| P8-4 | Tag pills — inline `#tags` as styled badges; click to filter graph | `5b4ea23` |
| P8-5 | Breadcrumb trail — folder path at top of reader | `5b4ea23` |
| P8-6 | Backlinks — bottom of pane lists all notes linking here | `5b4ea23` |

---

## v1.5.x — 2026-03-06 · Focus Mode + Semantic Ultranodes

| Version | Description |
|---------|-------------|
| v1.5.4 | Focus mode lock — H key locks visible cluster; ESC/Reset All clears it |
| v1.5.3 | Semantic ultranode detection; Inter font; URL param overrides |
| v1.5.2 | 3-tier node sizing + Ultranode size slider |
| v1.5.1 | _(incremental fixes)_ |
| v1.5.0 | Brain mesh R3 — anatomically accurate, normalised bounding box |

---

## v1.4.0 — 2026-03-06 · Brain Shape + Shapes Polish

| # | Feature | Commit |
|---|---------|--------|
| B-1 | Brain shape initial — 3D anatomical brain silhouette (parametric) | `bc2b0c0` |
| MW-1 | Milky Way 2-arm spiral + density gradient | `634823a` |
| SAT-1 | Saturn sphere+ring redesign | `3be4351` |
| PERF-1 | Performance pass — profiling, RAF buffering, sim ticks −33% | `cf09c86` |

---

## v1.3.x — 2026-03-05 · Phase 7+ — Shapes, Drag, Loading

| # | Feature | Commit |
|---|---------|--------|
| P7-8 | Right-click drag — moves grabbed node + connected neighbours as rigid cluster | `61269b3` |
| P7-9 | Saturn + Milky Way shapes added — renamed Orphan Pattern → Shape | `586c14a` |
| P7-10 | Loading indicator + auto-reset on shape switch | `3de554e` |
| P7-11 | Screen-space drag — camera-relative right/up vectors, no depth bleed | `3de554e` |
| P7-12 | `patternLoading` stuck-on-RECALCULATING bug fixed | `72966eb` |

*(v1.3.1–v1.3.15 are incremental shape-tuning and bugfix patches)*

---

## v1.2.x — 2026-03-04 · Phase 7 — Interaction & Layout Enhancements

| # | Feature/Fix | Commit |
|---|-------------|--------|
| HF-1 | Remove hardcoded vault path — use `os.homedir()` + `VAULT_PATH` env | `370cd97` |
| HF-2 | Gitignore `memory/`, `PRD.md`, `docs/` — purged from history | `aa2f81b` |
| HF-3 | Walk symlinked directories (vault `research/` symlink was invisible) | `038d432` |
| HF-4 | Rename `↺ POS` → `[ Reset View ]` | `079401d` |
| HF-5 | Selected node keeps folder colour (white was causing bloom bleed) | `a61e720` |
| HF-6 | Edge bloom only on connected edges | `f3a93d3` |
| P7-1 | Initial load auto-resets camera to bounding-sphere fit | `98c9115` |
| P7-2 | Centre of gravity recalculates on all filter changes | `71e3329` |
| P7-3 | ESC in search clears query, removes filter, blurs input | `ef857c8` |
| P7-4 | Note reader width persisted to localStorage | `5c6c194` |
| P7-5 | Backlink clicks respect zoom-to-node toggle | `3367973` |
| P7-6 | Max node size cap=10×, min=1× | `178892d` |
| P7-7 | Slider labels renamed: Node Size / Supernode Size | `88805de` |
| P7-8 | Right-click drag — rigid cluster drag | `5f86e90` |
| P7-9 | H key focus mode — isolate selected + connected | `39cdb12` |
| P7-10 | Orphan ring pattern (Saturn's rings) | `0951f24` |
| P7-11 | Jupiter → Saturn rename + redesign; Milky Way flat 2D spiral | `3992e03` |

*(v1.2.2–v1.2.14 are incremental patches on this phase)*

---

## v1.1.x — 2026-03-04 · Phase 2–4

### v1.1.2 · Phase 4 — Interaction Fixes
| # | Fix | Commit |
|---|-----|--------|
| P4-1 | 120fps — uncap setPixelRatio | `3e4639` |
| P4-2 | Scroll zoom anchors to mouse cursor | `ad9df7` |
| P4-3 | Tag click in note sidebar triggers tag filter | `cb78ae` |
| P4-4 | SPREAD slider max=10×, display as multiplier | `2377a6` |
| P4-5 | Collapse shows cluster centre (highest-degree per folder) | `26e181` |
| P4-6 | Distinguish click from drag — 5px threshold | `8b624a` |
| P4-7 | RESET ALL to Settings bottom | `79e508` |
| P4-8 | Pull isolated sub-clusters toward origin | `663c6a` |
| P4-9 | FlyTo stops 160px back | `6cc16a` |
| P4-10 | Cap min node size slider to 2× | `6a79af` |
| P4-11 | Keyboard arrow navigation + HUD breadcrumb | `4a6100` |
| P4-12 | Sidebar drag-handle resize (280–800px), persisted | `af8e63` |

### v1.1.1 · Phase 3 — UX Fixes
| # | Fix | Commit |
|---|-----|--------|
| P3-1 | Camera reset fits all nodes — bounding box centroid + 10% padding | `04afffa` |
| P3-2 | Orphan nodes gravitate toward global centroid | `deff98e` |
| P3-3 | Cap max node size slider to 2× base radius | `0c9d79` |
| P3-4 | Cyan annotation line from cursor to closest node | `7b299a` |
| P3-5 | Settings + shortcuts open by default, persisted | `ce552f` |
| P3-6 | Shift+[ collapses all nodes to root cluster | `71cd06` |
| P3-7 | Right-click node flashes visual feedback | `4c03b8` |
| P3-8 | Left click anywhere opens proximity-previewed note | `2b4f03` |
| P3-9 | Lint: extract orphanForce variable | `60653d` |

### v1.1.0 · Phase 2 — 9 UI Enhancements
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

**Commit:** `4cef3bf` · **Build time:** 16 minutes  
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

## Roadmap

| Version | Description |
|---------|-------------|
| TBD | Obsidian community plugin submission |
| TBD | npm package release |
| TBD | Temporal/causal memory for node history |
