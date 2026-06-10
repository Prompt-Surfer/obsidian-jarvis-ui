# Natural-pattern stutter — diagnosis, measurement, fix plan

Date: 2026-06-10 · Branch: `claude/natural-pattern-stuttering-psqn60`

## TL;DR

Natural is the **only** pattern where the d3 simulation actually runs its expensive
forces (`forceManyBody` + `forceLink` + `forceCollide`). All shape patterns
(Sun/Saturn/Milky Way/Brain/TagBoxes) zero those forces out and pre-place nodes at
their targets, so they converge in a handful of cheap ticks. In Natural the worker
streams full-graph position snapshots for many seconds, and **every snapshot crosses
the worker→main boundary as a structured-cloned object array, triggers a React
re-render of the whole App, and re-runs O(nodes+links) effects** — on top of the
O(nodes+links) per-frame lerp loop. The stutter is main-thread allocation/render
churn, not WebGL.

## Why only Natural stutters

Force configuration (`src/workers/force3d.worker.ts`):

| Force | Natural | Shape patterns |
|---|---|---|
| `forceManyBody` (Barnes-Hut octree per tick) | −120…−350/node | strength 0 |
| `forceLink` | 0.5 | strength 0 |
| `forceCollide(12)` (2nd octree per tick) | on | `null` |
| Initial positions | random scatter ±400 | pre-placed at targets |
| Convergence | up to 200 ticks, seconds | a few ticks |

Consequences in Natural:

1. **Long streaming window.** `runTick()` batches ticks into a 16 ms budget and posts
   one message per batch. Natural ticks are expensive (two octrees + link pass), so a
   batch often holds 1–2 ticks and the stream lasts seconds — the entire forming
   animation runs under message pressure.
2. **Structured-clone cost per message.** Each message carries
   `getNodePositions(simNodes)`: an array of N fresh `{id, x, y, z, tier}` objects
   (string ids). Clone on the worker, de-clone on main, then garbage on both sides →
   periodic GC pauses (visible as 50–200 ms hitches).
3. **Per-message main-thread work** (`src/hooks/useForce3D.ts`):
   - movement tracking loops all nodes **and rebuilds a fresh `Map` per message**
     (`newPrev`), every message;
   - the rAF flush builds another full `Map` and calls `setPositions` → **React
     re-renders `App` (sidebar, HUD, settings…) once per animation frame** while the
     sim streams.
4. **`positions`-dependent effects** (`src/components/Graph3D.tsx` Effect 1): runs on
   every positions state change. Even when `needsMatrixUpdate` is false it still walks
   all nodes (visibility set + label loop), and every 2 s rebuilds the bounding sphere
   by allocating **one `THREE.Vector3` per node** — a periodic allocation spike that
   matches the "hitch every couple of seconds" feel.
5. **RAF lerp loop** is O(nodes + links) per frame with `Map.get(stringId)` lookups
   for every node and both endpoints of every link. Acceptable alone; stacked on 2–4
   it overruns the 16.7 ms budget.

### Drag path (worst case)

Right-drag in Natural keeps the sim hot **and** floods the channel:

- every `mousemove` → `onMoveNodes` → worker `moveNodes`, which reheats alpha to 0.35
  **and immediately posts an extra full-graph snapshot** (in addition to the tick
  stream). Mice report at 125–1000 Hz → message flood, each O(n) clone.
- `applyRightDragToScene` rewrites the **entire link buffer** per mousemove
  (`drag.nodeIds.includes(...)` per link).
- hover/proximity detection projects **every node to screen space per mousemove**, and
  `setHoveredNode`/`setTooltipPos` re-render `App` per mousemove.

## Startup glitches (issue 1)

1. **Origin blob flash**: the instanced mesh is built with every instance at
   `(0,0,0)`, scale 1 (Graph3D "build instanced mesh" effect). Until the first sim
   batch applies matrices, all N spheres render stacked at the origin — a bright
   bloom-amplified blob. Natural's slow first ticks make it linger.
   *Fix: initialise instances at scale 0 (`dummy.scale.set(0,0,0)`).*
2. **Premature camera auto-fit**: `App.tsx` resets the camera on the *first* positions
   tick. In Natural the first tick is still random scatter that then expands under
   charge forces, so the framing is wrong until the second reset at `simDone`.
   *Fix: in Natural, defer the auto-reset until alpha < ~0.1 or simDone.*
3. **Dev-only StrictMode double-mount**: scene + worker are created, torn down and
   recreated once at startup (worker init runs twice). Harmless in prod builds, but
   causes a visible re-init flash in dev.
4. **Lerp catch-up rubber-banding**: displayed positions snap to the first tick, then
   chase fast-moving targets at `LERP_FACTOR 0.08` — early forming frames look
   elastic. Symptom of targets moving faster than the lerp, disappears with the fixes
   below.

## How to measure the stutter

Average FPS hides it — the stutter is the *tail* of the frame-interval distribution.
Three tools were added (this branch):

1. **`window.__stutter`** (`src/lib/stutterMeter.ts`) — start/stop capture from the
   console or Playwright. Runs its own rAF loop (independent of the dirty-flag render
   gate) + a `longtask` PerformanceObserver. Reports p50/p95/p99/max frame interval,
   long frames (>1.5× baseline), severe frames (>50 ms), `stutterTimePct`, and long
   task count — GC/structured-clone pauses show up here even when WebGL is fast.
2. **Perf HUD additions** (`?perf` query param, Graph3D): live `rAF p95 / max` and
   `Long frames >25ms` counters next to the existing Render/Sim FPS lines.
3. **`tests/stutter-measure.spec.ts`** — drives the exact stutter scenarios
   (pattern-switch forming phase + 5 s right-drag wiggle) for Saturn, Sun and Natural,
   prints a comparison table and writes `benchmarks/stutter-report.json`.

Definition of done for "smooth at 60fps+": during Natural forming **and** drag,
`p95 ≤ 17 ms`, `severeFrames = 0`, `stutterTimePct < 5 %`, long tasks = 0.

> Validation note: the spec was run end-to-end in a headless container (400-note
> synthetic vault). It passes and produces the table + JSON, but that environment
> renders WebGL through SwiftShader (software GPU, ~5 fps baseline), so absolute
> numbers from CI-like machines are not representative — run on real hardware for
> the actual stutter comparison. `benchmarks/stutter-report.json` is generated
> output and should not be treated as a committed baseline.

## Fix plan (prioritised)

| # | Fix | Effort | Expected win |
|---|---|---|---|
| P1 | **Binary position protocol**: send node-id order once at init; each tick posts a `Float32Array(3N)` via transferable. Main keeps two Float32Arrays (target/displayed) and lerps by index — no Maps, no clones, no GC. | M | Removes the biggest hitch source (clone+GC) |
| P2 | **Take React out of the hot path**: stop calling `setPositions` per batch. Write into a ref the RAF loop reads; keep state updates only for `simDone`/`tagBoxes`. Kills the per-frame App re-render + Effect-1 churn while streaming. | M | Steady-state 60 fps during forming |
| P3 | **Drag throttling**: coalesce `moveNodes` to ≤1 worker message per rAF; delete the per-`moveNodes` snapshot reply (the tick stream already carries positions). | S | Smooth dragging |
| P4 | **Cheapen Natural ticks**: `forceManyBody().distanceMax(~800)` (far-field cutoff, big win), and disable `forceCollide` once `alpha < 0.05` (overlap resolution only matters early). Optionally run collide every 2nd tick. | S | 2–4× faster ticks → shorter streaming window |
| P5 | **Effect-1 short-circuit**: when only positions changed, skip the node/label loops entirely; compute the bounding sphere from the typed array without allocating `Vector3`s. | S | Removes 2 s periodic spike |
| P6 | **Hover off React**: update tooltip via a DOM ref (transform), throttle the O(n) proximity scan to rAF. | S | No jank while moving the mouse |
| P7 | Startup: instances start at scale 0; Natural camera auto-fit deferred to alpha<0.1. | S | No origin blob / wrong framing |

P1+P2 are the structural fixes — they make frame cost independent of how long the sim
streams. P3/P4 make Natural converge faster and drag stay light. With all of them,
Natural's per-frame main-thread cost is the same O(n) typed-array lerp the shape
patterns enjoy today.
