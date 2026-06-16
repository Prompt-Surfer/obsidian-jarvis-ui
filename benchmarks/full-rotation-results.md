# Full 360° rotation around centre of gravity (2026-06-16)

Branch `fix/full-rotation` (off master @ v2.16.1, local only).

## Problem

Vertical rotation stopped at a certain angle — you couldn't tumble the graph all
the way over the top/bottom. Cause: the camera used **OrbitControls**, which keeps
a fixed up-vector and structurally clamps the polar (vertical) angle to [0, π].
You can spin horizontally forever but vertical rotation halts at the poles.

## Fix

Switched the camera to **TrackballControls** (the scheme CAD/molecule viewers use):
no fixed up-vector, so the camera tumbles freely in any direction around its
target — full continuous 360° vertical and horizontal rotation around the centre
of gravity (target = graph centroid, unchanged).

Integration preserved:
- left-drag = rotate (free tumble), middle = dolly/zoom
- **right-click stays free for node dragging** — `mouseButtons.RIGHT` unmapped, and
  node-drag uses mouse events while TrackballControls uses pointer events, so they
  don't collide
- damped (inertial) motion: `staticMoving=false`, `dynamicDampingFactor=0.15`
- `noPan=true` (matches prior no-pan behaviour)
- min/max distance, flyTo (target lerp), reset, and the bounding-sphere maxDistance
  clamp all carry over (`controls.target` + `update()` API is compatible)
- added `controls.handleResize()` to the window-resize handler (TrackballControls
  caches screen size for its trackball projection)

## Verification (in-browser, 10k-node vault)

- **rotation probe**: a sustained 2,400px vertical drag, screenshots every 600px —
  all 5 frames distinct (`allDistinct: true`). The view kept changing through the
  entire drag; with OrbitControls it would have frozen at the pole (identical
  consecutive frames). Screenshots show the graph from top, side, and over-the-top
  angles.
- right-click node drag: still works (moves during drag, persists after drop)
- no console/page errors; tsc + lint clean

## Notes / tradeoffs

- TrackballControls permits camera **roll** (z-axis) on circular drags — expected
  for free tumbling; not harmful for a point cloud.
- **zoom-to-cursor is lost** (OrbitControls had it); zoom now centres on the target.
  Minor; can be re-added with a custom wheel handler if wanted.
- `rotateSpeed=3.0` chosen for a responsive feel; tune to taste.
