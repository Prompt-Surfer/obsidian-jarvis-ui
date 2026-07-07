import { BUILTIN_SHAPES, type GraphShape, type ImportedShapeDef } from './types'
import { blackhole } from './imported/blackhole'

const IMPORTED_PREFIX = 'imported:'

/** Add newly ported shapes here — they appear in the Settings dropdown automatically. */
export const importedShapes: ImportedShapeDef[] = [blackhole]

export function getImportedShape(shape: string): ImportedShapeDef | undefined {
  if (!shape.startsWith(IMPORTED_PREFIX)) return undefined
  const id = shape.slice(IMPORTED_PREFIX.length)
  return importedShapes.find((s) => s.id === id)
}

export function isImportedShape(shape: string): boolean {
  return shape.startsWith(IMPORTED_PREFIX) && getImportedShape(shape) !== undefined
}

/** Validate a persisted/URL shape value; unknown values return null so callers can fall back. */
export function asGraphShape(v: string | null): GraphShape | null {
  if (!v) return null
  if ((BUILTIN_SHAPES as readonly string[]).includes(v)) return v as GraphShape
  return isImportedShape(v) ? (v as GraphShape) : null
}

/** Deterministic PRNG so imported-shape target builds are identical across reruns. */
export function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
