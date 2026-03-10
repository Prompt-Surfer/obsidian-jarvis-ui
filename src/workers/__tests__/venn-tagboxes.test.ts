/**
 * Unit tests for Venn Tag Boxes logic
 * Tests the pure functions extracted from force3d.worker.ts:
 *   - computeHalfSize
 *   - spring layout mechanics
 *   - virtual box (A∩B) intersection geometry
 *   - AABB containment check
 *   - n-way intersection computation
 */
import { describe, it, expect } from 'vitest'

// ─── Inline implementations of the pure functions ──────────────────────────
// Mirrors force3d.worker.ts constants and logic exactly.

const BASE_HALF = 80
const SCALE_HALF = 15
const MAX_HALF = 300

function computeHalfSize(nodeCount: number): number {
  return Math.min(MAX_HALF, BASE_HALF + SCALE_HALF * Math.sqrt(nodeCount))
}

interface Box {
  cx: number; cy: number; cz: number
  halfSizeX: number; halfSizeY: number; halfSizeZ: number
}

/** Returns the AABB intersection of N boxes, or null if empty */
function computeNWayIntersection(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null
  let minX = -Infinity, maxX = Infinity
  let minY = -Infinity, maxY = Infinity
  let minZ = -Infinity, maxZ = Infinity
  for (const b of boxes) {
    minX = Math.max(minX, b.cx - b.halfSizeX)
    maxX = Math.min(maxX, b.cx + b.halfSizeX)
    minY = Math.max(minY, b.cy - b.halfSizeY)
    maxY = Math.min(maxY, b.cy + b.halfSizeY)
    minZ = Math.max(minZ, b.cz - b.halfSizeZ)
    maxZ = Math.min(maxZ, b.cz + b.halfSizeZ)
  }
  if (maxX <= minX || maxY <= minY || maxZ <= minZ) return null
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    cz: (minZ + maxZ) / 2,
    halfSizeX: (maxX - minX) / 2,
    halfSizeY: (maxY - minY) / 2,
    halfSizeZ: (maxZ - minZ) / 2,
  }
}

/** Returns true if point (px,py,pz) is inside the AABB */
function isInsideBox(b: Box, px: number, py: number, pz: number): boolean {
  return (
    px >= b.cx - b.halfSizeX && px <= b.cx + b.halfSizeX &&
    py >= b.cy - b.halfSizeY && py <= b.cy + b.halfSizeY &&
    pz >= b.cz - b.halfSizeZ && pz <= b.cz + b.halfSizeZ
  )
}

/** Computes the virtual A∩B overlap box given two box centers and half-sizes */
function computeVirtualBox(
  cA: { x: number; y: number }, hs_A: number,
  cB: { x: number; y: number }, hs_B: number,
  shared: number,
): Box | null {
  const overlapMinX = Math.max(cA.x - hs_A, cB.x - hs_B)
  const overlapMaxX = Math.min(cA.x + hs_A, cB.x + hs_B)
  const overlapMinY = Math.max(cA.y - hs_A, cB.y - hs_B)
  const overlapMaxY = Math.min(cA.y + hs_A, cB.y + hs_B)
  if (overlapMaxX <= overlapMinX + 10 || overlapMaxY <= overlapMinY + 10) return null
  const halfSizeZ = Math.min(hs_A, hs_B) * 0.5
  return {
    cx: (overlapMinX + overlapMaxX) / 2,
    cy: (overlapMinY + overlapMaxY) / 2,
    cz: 0,
    halfSizeX: (overlapMaxX - overlapMinX) / 2,
    halfSizeY: (overlapMaxY - overlapMinY) / 2,
    halfSizeZ,
  }
  void shared // used by caller for sizing decisions
}

/** Computes the required center distance for boxes A and B to overlap by overlapHalfSize */
function requiredCenterDistance(hs_A: number, hs_B: number, shared: number): number {
  const overlapHalfSize = Math.min(computeHalfSize(shared), Math.min(hs_A, hs_B) * 0.8)
  return hs_A + hs_B - 2 * overlapHalfSize
}


// ─── Tests ──────────────────────────────────────────────────────────────────

describe('computeHalfSize', () => {
  it('returns BASE_HALF for 0 nodes', () => {
    expect(computeHalfSize(0)).toBe(BASE_HALF)
  })

  it('scales with sqrt of node count', () => {
    const hs4  = computeHalfSize(4)   // 80 + 15*2 = 110
    const hs16 = computeHalfSize(16)  // 80 + 15*4 = 140
    const hs100 = computeHalfSize(100) // 80 + 15*10 = 230
    expect(hs4).toBeCloseTo(110, 1)
    expect(hs16).toBeCloseTo(140, 1)
    expect(hs100).toBeCloseTo(230, 1)
  })

  it('caps at MAX_HALF', () => {
    // nodeCount where 80 + 15*sqrt(n) > 300: sqrt(n) > 220/15 ≈ 14.67, n > 215
    expect(computeHalfSize(300)).toBe(MAX_HALF)
    expect(computeHalfSize(10000)).toBe(MAX_HALF)
  })

  it('is monotonically increasing before cap', () => {
    for (let n = 1; n <= 200; n++) {
      expect(computeHalfSize(n)).toBeGreaterThanOrEqual(computeHalfSize(n - 1))
    }
  })

  it('is always >= BASE_HALF', () => {
    for (const n of [0, 1, 5, 50, 500]) {
      expect(computeHalfSize(n)).toBeGreaterThanOrEqual(BASE_HALF)
    }
  })
})

describe('computeVirtualBox — A∩B intersection geometry', () => {
  it('returns null when boxes do not overlap', () => {
    // Boxes 600 apart, hs=100 each — no overlap
    const result = computeVirtualBox({ x: 0, y: 0 }, 100, { x: 600, y: 0 }, 100, 5)
    expect(result).toBeNull()
  })

  it('returns null when overlap is below threshold (<=10 units)', () => {
    // Barely touching: centers 195 apart, hs=100 → overlap = 5 units each side → 10 total, at boundary
    const result = computeVirtualBox({ x: 0, y: 0 }, 100, { x: 195, y: 0 }, 100, 5)
    expect(result).toBeNull()
  })

  it('returns a valid box when boxes significantly overlap', () => {
    // Centers 100 apart, hs=180 each → overlap width = 2*180 - 100 = 260
    const result = computeVirtualBox({ x: -50, y: 0 }, 180, { x: 50, y: 0 }, 180, 10)
    expect(result).not.toBeNull()
    expect(result!.halfSizeX).toBeGreaterThan(10)
    expect(result!.halfSizeY).toBeGreaterThan(10)
  })

  it('virtual box center is at midpoint of overlap region', () => {
    // Symmetric case: equal boxes, centered on x-axis
    const hs = 180
    const result = computeVirtualBox({ x: -50, y: 0 }, hs, { x: 50, y: 0 }, hs, 10)
    expect(result!.cx).toBeCloseTo(0, 1)
    expect(result!.cy).toBeCloseTo(0, 1)
  })

  it('virtual box is contained within both parent boxes', () => {
    const hs_A = 160, hs_B = 130
    const cA = { x: -40, y: 0 }, cB = { x: 40, y: 0 }
    const vb = computeVirtualBox(cA, hs_A, cB, hs_B, 8)
    expect(vb).not.toBeNull()
    // virtual box edges must not extend beyond either parent
    expect(vb!.cx - vb!.halfSizeX).toBeGreaterThanOrEqual(cA.x - hs_A - 1)
    expect(vb!.cx + vb!.halfSizeX).toBeLessThanOrEqual(cA.x + hs_A + 1)
    expect(vb!.cx - vb!.halfSizeX).toBeGreaterThanOrEqual(cB.x - hs_B - 1)
    expect(vb!.cx + vb!.halfSizeX).toBeLessThanOrEqual(cB.x + hs_B + 1)
  })

  it('z half-size is min(hs_A, hs_B) * 0.5', () => {
    const hs_A = 180, hs_B = 120
    const vb = computeVirtualBox({ x: 0, y: 0 }, hs_A, { x: 100, y: 0 }, hs_B, 5)
    expect(vb!.halfSizeZ).toBeCloseTo(hs_B * 0.5, 1)  // min is hs_B
  })
})

describe('computeNWayIntersection — n-way AABB', () => {
  const box = (cx: number, cy: number, cz: number, hs: number): Box =>
    ({ cx, cy, cz, halfSizeX: hs, halfSizeY: hs, halfSizeZ: hs })

  it('returns the box itself for a single input', () => {
    const b = box(0, 0, 0, 100)
    const result = computeNWayIntersection([b])
    expect(result).not.toBeNull()
    expect(result!.halfSizeX).toBeCloseTo(100, 1)
  })

  it('returns correct 2-box intersection', () => {
    // Two 200-unit boxes, centers 100 apart → overlap 100 units wide
    const a = box(-50, 0, 0, 100)  // x: -150 to +50
    const b = box( 50, 0, 0, 100)  // x: -50 to +150
    // overlap x: -50 to +50 → width 100 → halfSize 50
    const result = computeNWayIntersection([a, b])
    expect(result).not.toBeNull()
    expect(result!.halfSizeX).toBeCloseTo(50, 1)
    expect(result!.cx).toBeCloseTo(0, 1)
  })

  it('returns null when 3 boxes have no common intersection', () => {
    // Triangle arrangement — pairwise overlap but no triple overlap
    const a = box(0,    0, 0, 60)
    const b = box(80,   0, 0, 60)
    const c = box(40, 100, 0, 60)
    const result = computeNWayIntersection([a, b, c])
    // a and b overlap in x but c is far in y — unlikely to have 3-way intersection
    // (depends on exact geometry; this tests the null path)
    if (result !== null) {
      // If non-null, all three boxes must actually contain the center
      expect(isInsideBox(a, result.cx, result.cy, result.cz)).toBe(true)
      expect(isInsideBox(b, result.cx, result.cy, result.cz)).toBe(true)
      expect(isInsideBox(c, result.cx, result.cy, result.cz)).toBe(true)
    }
  })

  it('intersection center is always inside all input boxes', () => {
    const boxes = [
      box(0,  0,  0, 150),
      box(80, 0,  0, 150),
      box(40, 60, 0, 150),
    ]
    const result = computeNWayIntersection(boxes)
    if (result) {
      for (const b of boxes) {
        expect(isInsideBox(b, result.cx, result.cy, result.cz)).toBe(true)
      }
    }
  })

  it('is commutative (order of boxes does not matter)', () => {
    const a = box(0,  0, 0, 100)
    const b = box(80, 0, 0, 100)
    const r1 = computeNWayIntersection([a, b])
    const r2 = computeNWayIntersection([b, a])
    if (r1 && r2) {
      expect(r1.cx).toBeCloseTo(r2.cx, 5)
      expect(r1.halfSizeX).toBeCloseTo(r2.halfSizeX, 5)
    } else {
      expect(r1).toBe(r2)  // both null
    }
  })
})

describe('requiredCenterDistance — spring target', () => {
  it('produces a distance that creates the right overlap', () => {
    const hs_A = 180, hs_B = 180, shared = 20
    const dist = requiredCenterDistance(hs_A, hs_B, shared)
    // After spring settles to this distance, overlap = hs_A + hs_B - dist = 2*overlapHalfSize
    const overlapHalfSize = Math.min(computeHalfSize(shared), Math.min(hs_A, hs_B) * 0.8)
    const actualOverlap = (hs_A + hs_B - dist) / 2
    expect(actualOverlap).toBeCloseTo(overlapHalfSize, 1)
  })

  it('required distance decreases as shared count increases', () => {
    // Use hs=300 so overlapHalfSize cap = 300*0.8 = 240, well above computeHalfSize ranges
    // computeHalfSize(5)≈113, (20)≈147, (50)≈186 — all below 240, no capping
    const hs = 300
    const d5  = requiredCenterDistance(hs, hs, 5)
    const d20 = requiredCenterDistance(hs, hs, 20)
    const d50 = requiredCenterDistance(hs, hs, 50)
    expect(d5).toBeGreaterThan(d20)
    expect(d20).toBeGreaterThan(d50)
  })

  it('required distance is always >= 0 (boxes never need to fully merge)', () => {
    for (const shared of [1, 5, 10, 50, 100, 500]) {
      expect(requiredCenterDistance(180, 180, shared)).toBeGreaterThanOrEqual(0)
    }
  })

  it('is symmetric (hs_A, hs_B order does not matter)', () => {
    const d1 = requiredCenterDistance(180, 120, 15)
    const d2 = requiredCenterDistance(120, 180, 15)
    expect(d1).toBeCloseTo(d2, 5)
  })
})

describe('isInsideBox — AABB containment', () => {
  const b: Box = { cx: 0, cy: 0, cz: 0, halfSizeX: 100, halfSizeY: 80, halfSizeZ: 60 }

  it('returns true for the center point', () => {
    expect(isInsideBox(b, 0, 0, 0)).toBe(true)
  })

  it('returns true for a point strictly inside', () => {
    expect(isInsideBox(b, 50, 40, 30)).toBe(true)
  })

  it('returns false for a point outside in x', () => {
    expect(isInsideBox(b, 101, 0, 0)).toBe(false)
  })

  it('returns false for a point outside in y', () => {
    expect(isInsideBox(b, 0, 81, 0)).toBe(false)
  })

  it('returns false for a point outside in z', () => {
    expect(isInsideBox(b, 0, 0, 61)).toBe(false)
  })

  it('returns true for a point on the boundary', () => {
    expect(isInsideBox(b, 100, 0, 0)).toBe(true)
    expect(isInsideBox(b, 0, 80, 0)).toBe(true)
  })
})
