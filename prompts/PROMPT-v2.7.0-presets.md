# Jarvis v2.7.0 — Save/Load Presets

## Context
Obsidian Jarvis UI is a 3D knowledge graph visualizer for Obsidian vaults. Built with React + TypeScript + Three.js + d3-force-3d. Currently at v2.6.0 (timelapse animation).

**Repo:** `./` (worktree on `feat/timelapse-animation` branch)
**You should create a new branch** `feat/presets` from the current HEAD of this worktree.

## Feature: Save/Load Presets

Users should be able to save their current view configuration as a named preset and load it later. Think of it like browser bookmarks but for graph views.

### What gets saved in a preset:
1. **Settings panel state** — all slider values (opacity, box size, top tags), toggles (bloom, links, stars, scanlines), current shape
2. **Camera position & target** — so the user returns to the same viewpoint
3. **Pinned/favourite notes** — the list of favourited note IDs
4. **Active filters** — current tag filter pills, time range preset (1D/1W/1M/1Y/ALL), search query
5. **Preset name** — user-provided label (e.g. "Work Notes", "Recent Research", "Full Overview")

### UI Design:
- Add a **Presets section** in the Settings panel (below existing settings)
- **Save Preset** button — opens a small inline text input for the name, then saves
- **Preset list** — shows saved presets as clickable items with:
  - Preset name (clickable to load)
  - Delete button (× icon)
  - Brief subtitle showing what's in it (e.g. "12 favourites, #ai #research, 1M")
- **Load** — clicking a preset name restores all saved state
- Style: match existing HUD/Jarvis aesthetic (dark, cyan accents, monospace)

### Storage:
- Save to `localStorage` under key `jarvis-presets`
- Format: `{ presets: [{ id, name, createdAt, settings, camera, favourites, filters }] }`
- Max 20 presets (soft limit, warn if approaching)

### Technical approach:
1. Create `src/hooks/usePresets.ts` — manages preset CRUD (save/load/delete/list)
2. Create `src/components/PresetManager.tsx` — UI component for the presets section
3. Wire into `Settings.tsx` — add PresetManager at the bottom
4. Wire into `App.tsx` — pass current state to save, apply loaded state

### Camera state capture:
- Read from Three.js camera: `camera.position.toArray()`, `controls.target.toArray()`
- On load: set `camera.position.fromArray(...)`, `controls.target.fromArray(...)`, call `controls.update()`

### Settings state to capture:
Look at `App.tsx` for all the state variables — they include:
- `bloom`, `opacity`, `showLinks`, `showStars`, `scanlines`
- `shape` (Natural, Brain, Saturn, MilkyWay, TagBoxes)
- `topTags`, `boxSize`
- Any other settings sliders/toggles

### Filters state to capture:
- `tagFilter` (array of active tag strings)
- Time range preset or custom range
- Search query text

### Favourites:
- Read from existing `favourites` state (Set of note IDs)

## Constraints
- Do NOT modify the existing settings behavior — presets are additive
- Keep all existing keyboard shortcuts working
- No new npm dependencies needed
- Run `npm run build` to verify — must be clean
- Bump version to 2.7.0 in package.json
- Atomic commits per logical unit

## Validation
1. `npm run build` — clean, no errors
2. `npm run lint` — clean (if configured)
3. Manual check: open http://localhost:5173, change some settings, save a preset, reload page, load the preset — all state should restore

## Completion
Write report to `/tmp/cc-jarvis-v270-completion-report.md` then run:
```bash
export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH"
WAKE_TELEGRAM_TOPIC=2397 bash ~/.openclaw/workspace/skills/claude-code-orchestrator/scripts/wake.sh "Jarvis v2.7.0 Save/Load Presets complete. Report at /tmp/cc-jarvis-v270-completion-report.md" now
```
