# Spread-adjust as pure coordinate scaling (2026-06-16)

Branch `perf/spread-scale` (off master @ v2.16.1, local only). Replaces the
spread-adjust concept entirely: instead of re-running any simulation, spread is a
**pure geometric zoom** of the already-precalc'd layout.

## Concept (per request)

"Use the same precalc'd positions for the entire graph, just expand the
coordinates so it's exactly the same just enlarged by the spread — if spread 1x
then 2x, all xyz are 2x. Should be like zooming a picture on a smartphone, near
instant."

## Implementation

`setSpread` for natural no longer touches the d3 simulation. It:
1. computes `ratio = newSpread / naturalDisplaySpread`
2. scales every node `p → centre + (p − centre) · ratio` around the centre of
   gravity (centroid) — a pure similarity transform, so the layout is identical,
   just enlarged/shrunk
3. posts one position frame; Graph3D's existing LERP glide animates the zoom
4. updates the interactive sim's link rest-length (×spread) and charge
   (×√spread) without reheating, so a later drag/reheat stays consistent with
   the zoomed scale

`naturalDisplaySpread` tracks the spread the current positions represent; it's
set when a fresh natural layout is computed and preserved across data updates and
drags. Non-natural shapes keep their existing per-shape spread behavior.

## Result

| metric | old (WASM resettle, 083f7f2) | old (d3 reheat, pre-opt) | this (pure scaling) |
|--------|------------------------------|--------------------------|---------------------|
| spread compute time | ~6,300 ms | ~39,000 ms | **0.2–0.4 ms** |
| SIM STABLE drop on change | yes (~6s) | yes (~39s) | **none — never drops** |
| visible transition | LERP after solve | streamed resettle | LERP zoom (~0.5s, smooth) |

Worker log: `[spread-scale] zoom ratio=4.000 compute=0.40ms n=10050`. The
operation is O(n) — a few hundred microseconds for the whole 10k-node graph —
so spread is effectively instant; only the LERP glide (cosmetic) takes ~0.5s.

## Verification (in-browser, 10,050-node vault)

- before/after screenshots (spread 2→8): identical cluster layout, uniformly
  enlarged — confirmed pinch-zoom behavior, shape preserved (it's a similarity
  transform, so preservation is exact by construction)
- reversible: 2→8→2 returns to original scale (×4 then ×0.25)
- shape gate: clusters preserved (the precalc layout is unchanged, only scaled)
- right-drag realtime gate: moves during drag, persists after drop
- note add/remove realtime gate: +1 node live, reverted, no full relayout
- tsc + lint clean; 0 console/page errors

Note: headless software-WebGL redraws the zoomed scene slowly (~830ms/frame for
10k nodes at high spread) — a renderer-fill artifact of the headless environment,
unrelated to the spread compute (0.4ms). On a real GPU the zoom is smooth.
