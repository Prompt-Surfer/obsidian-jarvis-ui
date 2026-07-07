import { BUILTIN_SHAPES, type GraphShape, type ImportedShapeDef } from './types'
import { blackhole } from './imported/blackhole'
import { CASBERRY_PREFIX, casberryShapeName, casberryShapeDef, fetchFormation } from './casberry'

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
  // Community-cloud ids are accepted syntactically — existence is checked at load time
  if (casberryShapeName(v)) return v as GraphShape
  return isImportedShape(v) ? (v as GraphShape) : null
}

const dynamicCache = new Map<string, ImportedShapeDef>()

/**
 * Resolve any imported shape id, including dynamic providers. Static ports
 * resolve immediately; `imported:casberry:<NAME>` fetches the formation from
 * the community cloud and compiles it (cached per session).
 */
export async function resolveImportedShape(shape: string): Promise<ImportedShapeDef | undefined> {
  const staticDef = getImportedShape(shape)
  if (staticDef) return staticDef
  const cached = dynamicCache.get(shape)
  if (cached) return cached
  const name = casberryShapeName(shape)
  if (!name) return undefined
  const def = casberryShapeDef(await fetchFormation(name))
  dynamicCache.set(shape, def)
  return def
}

export { CASBERRY_PREFIX, casberryShapeId, casberryShapeName, parseCasberryInput } from './casberry'

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
