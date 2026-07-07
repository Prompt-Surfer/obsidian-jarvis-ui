// Shared shape typing. Built-ins are hand-tuned layouts in the force worker;
// imported shapes are ported particle-swarm position functions resolved
// through src/shapes/registry.ts and selected as `imported:<id>`.
export const BUILTIN_SHAPES = ['natural', 'sun', 'saturn', 'milkyway', 'brain', 'tagboxes', 'trees'] as const
export type BuiltinShape = (typeof BUILTIN_SHAPES)[number]
export type GraphShape = BuiltinShape | `imported:${string}`

export interface ImportedShapeDef {
  id: string
  label: string
  icon: string
  /** Provenance of the ported position function (repo/site it came from). */
  source: string
  /** True when the formula uses `time` — the worker re-evaluates targets each tick. */
  animated?: boolean
  /**
   * Swarm position function in the casberry particle-simulator style:
   * particle i of count → target position in world units (pre-spread), y up.
   * Indices are assigned by node importance (degree desc), so i=0 is the
   * biggest hub — functions can reserve low indices for focal regions.
   * rng is deterministic and shared across the whole build (call order matters).
   * time (seconds) drives animated shapes; static ports ignore it.
   */
  position(i: number, count: number, rng: () => number, time?: number): { x: number; y: number; z: number }
}
