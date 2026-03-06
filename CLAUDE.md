# Obsidian Jarvis UI — Claude Code Context

## Project Overview
3D WebGL vault graph for Obsidian with Iron Man/Jarvis aesthetic.
Built with: React 18, TypeScript, Three.js, Vite, Express.

**Vault:** Set via `VAULT_PATH` env var (e.g. `export VAULT_PATH=~/Documents/MyVault`)
**Dev server:** `nohup npx tsx watch server/index.ts > /tmp/api.log 2>&1 &` + `nohup npx vite --host 0.0.0.0 > /tmp/vite.log 2>&1 &`
**Graph API:** `http://localhost:3001/api/graph`
**UI:** `http://localhost:5173`

## Architecture
- `server/index.ts` — Express API: parses vault `.md` files recursively (follows symlinks), extracts wikilinks, serves graph JSON
- `src/App.tsx` — main React component: graph state, sidebar, search, filters
- `src/components/Graph3D.tsx` — Three.js WebGL renderer: nodes, edges, bloom, labels, force simulation
- `src/components/Settings.tsx` — settings panel (left side)
- `force3d.worker.ts` — background force-directed layout worker

## Commit Message Convention (MANDATORY)
All commits MUST use **Conventional Commits** format. This drives automatic SemVer versioning via `tracking/bump-version.sh`.

```
<type>(<scope>): <description>

Types:
  feat      → new feature         → bumps MINOR (v1.X.0)
  fix       → bug fix             → bumps PATCH (v1.0.X)
  docs      → documentation only  → bumps PATCH
  chore     → build/config/tooling → bumps PATCH
```

### ⚠️ CRITICAL: When to use feat vs fix
- `feat:` = ONLY for adding a **brand new capability** that didn't exist before (new shape, new panel, new feature)
- `fix:` = EVERYTHING else: improving, tuning, redesigning, polishing, fixing bugs in existing features
- **Redesigning an existing feature is a FIX, not a feat.** Changing how Saturn looks = fix. Adding Saturn for the first time = feat.
- **When in doubt, use `fix:`.** Wrong feat bumps inflate the version number and can't be undone without history rewriting.
- After committing, run `bash tracking/bump-version.sh` to auto-tag with correct semver.
  refactor  → code restructure     → bumps PATCH
  perf      → performance          → bumps PATCH
  test      → tests only           → bumps PATCH
  style     → formatting only      → no bump

BREAKING CHANGE (in footer) or feat!: → bumps MAJOR (X.0.0)
```

**Examples:**
```
feat(graph): add semantic clustering via embeddings
fix(server): handle broken symlinks in vault walk
docs: update README with new keyboard shortcuts
chore: bump Three.js to v0.172
```

**Never** use generic messages like `update`, `fix stuff`, `wip`. Every commit should be independently readable.

## Versioning
- Current: **v1.6.0**
- After committing: `bash tracking/bump-version.sh` → auto-tags with correct semver
- Push release: `git push origin master && git push origin <tag>`
- Tracking: `tracking/tracking.md` — all phases and tasks

## Playwright Validation (MANDATORY before committing visual changes)
Before taking Playwright screenshots, ALWAYS restart the dev server to ensure you're testing the latest code:
```bash
# Kill any running dev server
pkill -f "vite" 2>/dev/null; pkill -f "tsx watch server" 2>/dev/null
sleep 2
# Start fresh
npm run dev &
sleep 5  # wait for both vite + api server to start
# THEN run playwright
npx playwright test <test-file> --timeout 90000
# Kill after
pkill -f "vite" 2>/dev/null; pkill -f "tsx watch server" 2>/dev/null
```
Never trust screenshots from a stale dev server. Rebuild + restart every time.

## Wake Callback (MANDATORY on task completion)
When finishing a task, send a wake notification so the orchestrator knows you're done.
The wake script path is defined by the orchestrator — check your task prompt for the exact command.
**Never skip this.**

## Key Patterns
- Node colours derive from `folder` field → `getNodeColor()` in Graph3D.tsx
- Edge highlights: `selectedEdgeLinesRef` overlay (cyan, additive blending) — base edges never change colour
- Symlink walk: `entry.isSymbolicLink() && fs.statSync(full).isDirectory()` required for vault `research/` symlink
- Force simulation runs in `force3d.worker.ts` — post messages to update positions each frame
- Settings persisted to `localStorage` (spread, nodeSize, zoom-to-node toggle, etc.)
