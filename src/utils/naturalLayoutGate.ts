// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

export interface ValidationInput {
  nodes: Array<{ id: string; x: number; y: number; z: number }>
  edges: Array<{ source: string; target: string }>
  alpha: number
  spread: number
}

export interface ComponentMetrics {
  size: number
  asymmetry: number
  cv: number
  coreDensity: number
  passed: boolean
  score: number // 0–1 normalized score for this component
}

export interface ScoreBreakdown {
  spatialExtent: number   // 0–25
  hubRatio: number        // 0–20
  branchingAsymmetry: number // 0–30
  coreDensity: number     // 0–25
}

export interface ValidationResult {
  passed: boolean
  score: number  // 0–100 composite
  failureReason?: string
  warnings: string[]
  breakdown: ScoreBreakdown
  metrics: {
    alpha: number
    spread: number
    nodeCount: number
    edgeCount: number
    largestComponentRatio: number
    spreadDivergence: number
    minDist: number
    maxDist: number
    normalizedExtent: number
    separationRatio: number
    hubRatio: number
    components: ComponentMetrics[]
  }
}

// ── Seeded PRNG (Mulberry32) ──────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Pairwise distance sampling ────────────────────────────────────────────────

function samplePairwiseDistances(
  pts: Array<{ x: number; y: number; z: number }>,
  k: number,
  seed: number,
): number[] {
  const n = pts.length
  const maxPairs = (n * (n - 1)) / 2
  if (maxPairs <= k) {
    const dists: number[] = []
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pts[i].x - pts[j].x
        const dy = pts[i].y - pts[j].y
        const dz = pts[i].z - pts[j].z
        dists.push(Math.sqrt(dx * dx + dy * dy + dz * dz))
      }
    }
    return dists
  }

  const rng = mulberry32(seed)
  const dists: number[] = []
  // Reservoir sampling of pairs encoded as a single index
  for (let attempt = 0; attempt < k * 4 && dists.length < k; attempt++) {
    const i = Math.floor(rng() * n)
    let j = Math.floor(rng() * n)
    if (j === i) continue
    const dx = pts[i].x - pts[j].x
    const dy = pts[i].y - pts[j].y
    const dz = pts[i].z - pts[j].z
    dists.push(Math.sqrt(dx * dx + dy * dy + dz * dz))
  }
  return dists
}

// ── Union-Find for connected components ──────────────────────────────────────

function findComponents(
  nodeIds: string[],
  edges: Array<{ source: string; target: string }>,
): Map<string, number>[] {
  const idToIdx = new Map<string, number>()
  nodeIds.forEach((id, i) => idToIdx.set(id, i))

  const parent = nodeIds.map((_, i) => i)
  const rank = new Array(nodeIds.length).fill(0)

  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x])
    return parent[x]
  }

  function union(a: number, b: number) {
    const ra = find(a), rb = find(b)
    if (ra === rb) return
    if (rank[ra] < rank[rb]) parent[ra] = rb
    else if (rank[ra] > rank[rb]) parent[rb] = ra
    else { parent[rb] = ra; rank[ra]++ }
  }

  for (const e of edges) {
    const a = idToIdx.get(e.source)
    const b = idToIdx.get(e.target)
    if (a !== undefined && b !== undefined) union(a, b)
  }

  const groups = new Map<number, Map<string, number>>()
  nodeIds.forEach((id, i) => {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, new Map())
    groups.get(root)!.set(id, i)
  })

  return Array.from(groups.values())
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

function hat(v: number, lo: number, peak: number, hi: number): number {
  if (v <= lo || v >= hi) return 0
  if (v <= peak) return (v - lo) / (peak - lo)
  return (hi - v) / (hi - peak)
}

function trapezoid(v: number, lo: number, p1: number, p2: number, hi: number): number {
  if (v <= lo || v >= hi) return 0
  if (v <= p1) return (v - lo) / (p1 - lo)
  if (v <= p2) return 1
  return (hi - v) / (hi - p2)
}

function percentile(sorted: number[], p: number): number {
  const idx = p * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// ── Main validation function ──────────────────────────────────────────────────

export function validateNaturalLayout(input: ValidationInput): ValidationResult {
  const { nodes, edges, alpha, spread } = input
  const nodeCount = nodes.length
  const edgeCount = edges.length
  const warnings: string[] = []

  const zero: ValidationResult = {
    passed: false, score: 0, warnings,
    breakdown: { spatialExtent: 0, hubRatio: 0, branchingAsymmetry: 0, coreDensity: 0 },
    metrics: {
      alpha, spread, nodeCount, edgeCount,
      largestComponentRatio: 0, spreadDivergence: 0,
      minDist: 0, maxDist: 0, normalizedExtent: 0, separationRatio: 0,
      hubRatio: 0, components: [],
    },
  }

  function fail(reason: string): ValidationResult {
    return { ...zero, failureReason: reason }
  }

  // ── PRE-VALIDATION (hard gates → score = 0) ────────────────────────────────

  if (alpha > 0.01) return fail(`alpha ${alpha.toFixed(4)} > 0.01 — simulation not settled`)
  if (spread < 0.5 || spread > 2.0) return fail(`spread ${spread} outside valid range [0.5, 2.0]`)

  if (nodeCount < 5) {
    return { ...zero, passed: true, score: 100,
      breakdown: { spatialExtent: 25, hubRatio: 20, branchingAsymmetry: 30, coreDensity: 25 },
      metrics: { ...zero.metrics, largestComponentRatio: 1 } }
  }

  // XYZ std dev
  const meanX = nodes.reduce((s, n) => s + n.x, 0) / nodeCount
  const meanY = nodes.reduce((s, n) => s + n.y, 0) / nodeCount
  const meanZ = nodes.reduce((s, n) => s + n.z, 0) / nodeCount
  const variance = nodes.reduce((s, n) =>
    s + (n.x - meanX) ** 2 + (n.y - meanY) ** 2 + (n.z - meanZ) ** 2, 0) / (nodeCount * 3)
  if (Math.sqrt(variance) < 0.001) return fail('nodes collapsed — xyz std dev < 0.001')

  // edge count + pairwise distance check
  let maxPairDist = 0
  if (edgeCount === 0) {
    const samp = samplePairwiseDistances(nodes, Math.min(nodeCount, 500), 42)
    maxPairDist = Math.max(...samp)
    if (maxPairDist < 0.5) return fail(`edgeCount = 0 and max pairwise dist ${maxPairDist.toFixed(4)} < 0.5`)
  }

  // Largest weakly connected component
  const nodeIds = nodes.map(n => n.id)
  const components = findComponents(nodeIds, edges)
  const largestCompSize = Math.max(...components.map(c => c.size))
  const largestComponentRatio = largestCompSize / nodeCount
  if (largestComponentRatio < 0.4) {
    return fail(`largest component ${(largestComponentRatio * 100).toFixed(1)}% < 40% of nodes`)
  }

  // ── SPREAD DIVERGENCE ──────────────────────────────────────────────────────

  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y), zs = nodes.map(n => n.z)
  const bboxW = Math.max(...xs) - Math.min(...xs)
  const bboxH = Math.max(...ys) - Math.min(...ys)
  const bboxD = Math.max(...zs) - Math.min(...zs)
  const bboxDiag = Math.sqrt(bboxW ** 2 + bboxH ** 2 + bboxD ** 2)
  const spreadImplied = bboxDiag / (Math.sqrt(nodeCount) * 60)
  const spreadDivergence = Math.abs(spreadImplied - spread) / spread
  if (spreadDivergence > 0.5) warnings.push(`spread divergence ${(spreadDivergence * 100).toFixed(1)}% > 50%`)
  else if (spreadDivergence > 0.3) warnings.push(`spread divergence ${(spreadDivergence * 100).toFixed(1)}% > 30%`)

  // ── METRIC B: SPATIAL EXTENT ───────────────────────────────────────────────

  const K_b = Math.min(nodeCount, 500)
  const bDists = samplePairwiseDistances(nodes, K_b, 42).sort((a, b) => a - b)
  const minDist = bDists[0] ?? 0
  const maxDist = bDists[bDists.length - 1] ?? 0
  const normalizedExtent = minDist > 0 ? (maxDist - minDist) / minDist : 0
  const pct5 = percentile(bDists, 0.05)
  const pct95 = percentile(bDists, 0.95)
  const separationRatio = pct5 > 0 ? pct95 / pct5 : 0

  // Score Metric B (25 pts) — thresholds calibrated for world-space (link_dist≈60)
  const bMinScore = minDist >= 1 ? 5 : 0
  const bMaxScore = maxDist >= 100 ? 5 : 0
  const bExtentScore = hat(normalizedExtent, 1, 300, 10000) * 8
  const bSepScore = hat(separationRatio, 1.5, 8.0, 200.0) * 7
  const spatialExtentScore = Math.min(25, bMinScore + bMaxScore + bExtentScore + bSepScore)

  // ── METRIC C: HUB RATIO ────────────────────────────────────────────────────

  const degreeMap = new Map<string, number>()
  nodes.forEach(n => degreeMap.set(n.id, 0))
  for (const e of edges) {
    degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1)
    degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1)
  }
  const degrees = Array.from(degreeMap.values())
  const meanDeg = degrees.reduce((s, d) => s + d, 0) / degrees.length
  const stdDeg = Math.sqrt(degrees.reduce((s, d) => s + (d - meanDeg) ** 2, 0) / degrees.length)
  const hubRatio = stdDeg / (meanDeg + 0.1)

  // Score Metric C (20 pts) — range widened for scale-free vaults (hub_ratio >> 3)
  const hubThreshold = nodeCount >= 20 ? 0.4 : 0.35
  const hubRatioScore = hubRatio < hubThreshold
    ? 0
    : trapezoid(hubRatio, hubThreshold, 5.0, 30.0, 100.0) * 20

  // ── METRICS D & E: PER-COMPONENT ──────────────────────────────────────────

  const posMap = new Map<string, { x: number; y: number; z: number }>()
  for (const n of nodes) posMap.set(n.id, { x: n.x, y: n.y, z: n.z })

  const componentMetrics: ComponentMetrics[] = []
  let dWeightedSum = 0, dTotalWeight = 0
  let eWeightedSum = 0, eTotalWeight = 0

  for (const compMap of components) {
    const compIds = Array.from(compMap.keys())
    const compSize = compIds.length

    const pts = compIds.map(id => posMap.get(id)!).filter(Boolean)

    if (compSize < 10) {
      componentMetrics.push({ size: compSize, asymmetry: 0, cv: 0, coreDensity: 0, passed: true, score: 1 })
      continue
    }

    // Seeded per-component: seed = 42 XOR (djb2 hash of sorted ids mod 2^31)
    const sortedIds = [...compIds].sort().join('')
    let hash = 5381
    for (let ci = 0; ci < sortedIds.length; ci++) {
      hash = ((hash << 5) + hash + sortedIds.charCodeAt(ci)) >>> 0
    }
    const compSeed = (42 ^ (hash % 0x7fffffff)) >>> 0

    const K_d = Math.min(500, compSize)
    const dists = samplePairwiseDistances(pts, K_d, compSeed).sort((a, b) => a - b)
    const asymmetry = dists.length > 0 ? percentile(dists, 0.95) / (percentile(dists, 0.5) || 0.001) : 0
    const meanDist = dists.reduce((s, d) => s + d, 0) / (dists.length || 1)
    const stdDist = Math.sqrt(dists.reduce((s, d) => s + (d - meanDist) ** 2, 0) / (dists.length || 1))
    const cv = meanDist > 0 ? stdDist / meanDist : 0

    // Metric D: branching asymmetry (upper bound widened to 20 for scale-free vaults)
    const dAsymPassed = asymmetry >= 1.3 && asymmetry <= 20.0
    const dCvPassed = cv > 0.35
    const dPassed = dAsymPassed && dCvPassed

    // Metric E: core density
    let centX = 0, centY = 0, centZ = 0
    for (const p of pts) { centX += p.x; centY += p.y; centZ += p.z }
    centX /= pts.length; centY /= pts.length; centZ /= pts.length

    let maxPairDistComp = 0
    // Use sampled dists already computed for E
    if (dists.length > 0) maxPairDistComp = dists[dists.length - 1]
    const r = maxPairDistComp / 4
    const coreCount = pts.filter(p => {
      const dx = p.x - centX, dy = p.y - centY, dz = p.z - centZ
      return Math.sqrt(dx * dx + dy * dy + dz * dz) <= r
    }).length
    const coreDensity = coreCount / compSize

    // Adaptive core-density threshold scales with hub dominance
    const maxDeg = Math.max(...Array.from(degreeMap.values()))
    const coreDensityThreshold = Math.min(0.22 + (maxDeg / nodeCount) * 0.62, 0.80)
    const ePassed = coreDensity <= coreDensityThreshold

    const passed = dPassed && ePassed

    // Score this component
    const asymScore = hat(asymmetry, 1.3, 2.5, 20.0)
    const cvScore = cv <= 0.35 ? 0 : cv <= 0.6 ? (cv - 0.35) / (0.6 - 0.35) : 1.0
    const compDScore = (asymScore + cvScore) / 2
    const compEScore = Math.max(0, (coreDensityThreshold - coreDensity) / coreDensityThreshold)
    const compScore = (compDScore + compEScore) / 2

    componentMetrics.push({ size: compSize, asymmetry, cv, coreDensity, passed, score: compScore })

    dWeightedSum += compDScore * compSize
    dTotalWeight += compSize
    eWeightedSum += compEScore * compSize
    eTotalWeight += compSize
  }

  const branchingAsymmetryScore = dTotalWeight > 0 ? (dWeightedSum / dTotalWeight) * 30 : 0
  const coreDensityScore = eTotalWeight > 0 ? (eWeightedSum / eTotalWeight) * 25 : 0

  const breakdown: ScoreBreakdown = {
    spatialExtent: Math.round(spatialExtentScore * 10) / 10,
    hubRatio: Math.round(hubRatioScore * 10) / 10,
    branchingAsymmetry: Math.round(branchingAsymmetryScore * 10) / 10,
    coreDensity: Math.round(coreDensityScore * 10) / 10,
  }

  const score = Math.round(
    Math.min(100, breakdown.spatialExtent + breakdown.hubRatio +
      breakdown.branchingAsymmetry + breakdown.coreDensity)
  )

  // Overall pass: all qualifying components must pass D & E
  const failedComponents = componentMetrics.filter(c => c.size >= 10 && !c.passed)
  const passed = failedComponents.length === 0 && score >= 40

  return {
    passed,
    score,
    failureReason: failedComponents.length > 0
      ? `${failedComponents.length} component(s) failed D/E checks`
      : score < 40 ? `composite score ${score} below minimum threshold (40)` : undefined,
    warnings,
    breakdown,
    metrics: {
      alpha, spread, nodeCount, edgeCount,
      largestComponentRatio,
      spreadDivergence,
      minDist, maxDist, normalizedExtent, separationRatio,
      hubRatio,
      components: componentMetrics,
    },
  }
}
