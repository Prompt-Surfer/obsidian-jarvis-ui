# Natural-layout cache + change-only recalc (2026-06-17)

Branch `feat/natural-cache` (off master @ v2.16.1 + spread-scale, local only).

## What it does

The natural layout is expensive to precalc. This caches the settled positions and
reuses them, and recomputes only what changed when the vault changes.

- **Persistent cache** (`src/lib/layoutCache.ts`): on every layout-defining settle
  the positions (Float32Array, base64) + node ids + a node-set signature are saved
  to `localStorage`. Transient states (drag, spread-zoom) are NOT cached, so the
  cache stays the canonical layout.
- **No recompute on reload**: on load the hook seeds the live channel from the
  cache; if the node set is unchanged the worker applies it **instantly** (one
  frame, no simulation).
- **No recompute on Reset All**: restores the cached layout via a new
  `applyPositions` worker message (no simulation), rebasing spread.
- **Change-only recalc**: when the vault watcher fires and the node set changed,
  unchanged nodes keep their cached positions; only added nodes are placed (beside
  a cached neighbour) and lightly relaxed, removed nodes drop out. Small edits keep
  the shape nearly identical.
- **Shape switch into natural** reuses the cache too (the in-memory channel holds
  the other shape's positions, so the hook seeds from cache instead).

## Verification (in-browser, ~10,057-node vault)

Worker logs distinguish the path taken:

| action | log | recompute? |
|--------|-----|-----------|
| first load (cold) | `[precalc-engine] wasm` | full precalc |
| reload | `[natural-layout] cache-hit: instant apply (no recompute)` | **none** |
| Reset All | `[natural-layout] applyPositions: restored cached layout (no recompute)` | **none** |
| add 1 note | `[natural-layout] change-only relax: 1 new node(s), 10057 reused` | **1 node only** |

- reload settle 2.9s (vs 7.8s cold) — and the layout itself applies instantly; the
  2.9s is graph-API fetch + canvas init, not layout compute
- reload/reset reproduce the same layout (shape identical; minor framing diff is
  camera-fit timing, not positions)
- drag realtime gate passes; production build + tsc + lint clean

## Files

- `src/lib/layoutCache.ts` — localStorage cache (save/load/sig)
- `src/hooks/useForce3D.ts` — seed-from-cache on init, save on layout-defining
  settle, `resetLayout()` for Reset All, cache-suppress flag for drag/spread
- `src/workers/force3d.worker.ts` — instant cache-hit fast path, `applyPositions`
  handler, change-only relax (pre-existing warm path, now cache-fed)
- `src/App.tsx` — Reset All restores cache instead of reheating
