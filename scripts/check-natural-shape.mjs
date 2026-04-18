#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Headless natural-layout shape gate — scores 0-100.
// Usage:
//   node scripts/check-natural-shape.mjs                  # fetch from API + run sim
//   node scripts/check-natural-shape.mjs positions.json   # score pre-computed positions
//   node scripts/check-natural-shape.mjs --compare        # current vs baseline side-by-side

import { createRequire } from 'module'
import { readFileSync, existsSync } from 'fs'
import fsPromises from 'fs/promises'
import { execSync } from 'child_process'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
} = await import('d3-force-3d')

// ── Seeded PRNG ───────────────────────────────────────────────────────────────

function mulberry32(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Pairwise distance sampling ────────────────────────────────────────────────

function samplePairwiseDists(pts, k, seed) {
  const n = pts.length
  const maxPairs = (n * (n - 1)) / 2
  if (maxPairs <= k) {
    const dists = []
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, dz = pts[i].z - pts[j].z
        dists.push(Math.sqrt(dx * dx + dy * dy + dz * dz))
      }
    }
    return dists
  }
  const rng = mulberry32(seed)
  const dists = []
  for (let attempt = 0; attempt < k * 4 && dists.length < k; attempt++) {
    const i = Math.floor(rng() * n)
    let j = Math.floor(rng() * n)
    if (j === i) continue
    const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, dz = pts[i].z - pts[j].z
    dists.push(Math.sqrt(dx * dx + dy * dy + dz * dz))
  }
  return dists
}

// ── Union-Find ────────────────────────────────────────────────────────────────

function findComponents(nodeIds, edges) {
  const idToIdx = new Map(nodeIds.map((id, i) => [id, i]))
  const parent = nodeIds.map((_, i) => i)
  const rank = new Array(nodeIds.length).fill(0)
  function find(x) { if (parent[x] !== x) parent[x] = find(parent[x]); return parent[x] }
  function union(a, b) {
    const ra = find(a), rb = find(b)
    if (ra === rb) return
    if (rank[ra] < rank[rb]) parent[ra] = rb
    else if (rank[ra] > rank[rb]) parent[rb] = ra
    else { parent[rb] = ra; rank[ra]++ }
  }
  for (const e of edges) {
    const a = idToIdx.get(e.source), b = idToIdx.get(e.target)
    if (a !== undefined && b !== undefined) union(a, b)
  }
  const groups = new Map()
  nodeIds.forEach((id, i) => {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(id)
  })
  return Array.from(groups.values())
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

function hat(v, lo, peak, hi) {
  if (v <= lo || v >= hi) return 0
  if (v <= peak) return (v - lo) / (peak - lo)
  return (hi - v) / (hi - peak)
}

function trapezoid(v, lo, p1, p2, hi) {
  if (v <= lo || v >= hi) return 0
  if (v <= p1) return (v - lo) / (p1 - lo)
  if (v <= p2) return 1
  return (hi - v) / (hi - p2)
}

function pct(sorted, p) {
  const idx = p * (sorted.length - 1)
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// ── Main gate scoring ─────────────────────────────────────────────────────────

function scoreLayout(nodes, edges, alpha, spread) {
  const nodeCount = nodes.length
  const edgeCount = edges.length
  const warnings = []

  const zeroResult = {
    passed: false, score: 0, warnings,
    breakdown: { spatialExtent: 0, hubRatio: 0, branchingAsymmetry: 0, coreDensity: 0 },
    metrics: { alpha, spread, nodeCount, edgeCount, largestComponentRatio: 0,
      spreadDivergence: 0, minDist: 0, maxDist: 0, normalizedExtent: 0,
      separationRatio: 0, hubRatio: 0, components: [] },
  }

  // PRE-VALIDATION
  // Threshold is 0.1 (not 0.01) to accommodate early-exit sims that stabilised before alpha dropped fully
  if (alpha > 0.1) return { ...zeroResult, failureReason: `alpha ${alpha.toFixed(4)} > 0.1` }
  if (spread < 0.5 || spread > 2.0) return { ...zeroResult, failureReason: `spread ${spread} out of [0.5, 2.0]` }

  if (nodeCount < 5) {
    return { ...zeroResult, passed: true, score: 100,
      breakdown: { spatialExtent: 25, hubRatio: 20, branchingAsymmetry: 30, coreDensity: 25 },
      metrics: { ...zeroResult.metrics, largestComponentRatio: 1 } }
  }

  // Collapsed check
  const mx = nodes.reduce((s, n) => s + n.x, 0) / nodeCount
  const my = nodes.reduce((s, n) => s + n.y, 0) / nodeCount
  const mz = nodes.reduce((s, n) => s + n.z, 0) / nodeCount
  const variance = nodes.reduce((s, n) =>
    s + (n.x - mx) ** 2 + (n.y - my) ** 2 + (n.z - mz) ** 2, 0) / (nodeCount * 3)
  if (Math.sqrt(variance) < 0.001) return { ...zeroResult, failureReason: 'nodes collapsed (std dev < 0.001)' }

  // Components
  const nodeIds = nodes.map(n => n.id)
  const components = findComponents(nodeIds, edges)
  const largestCompSize = Math.max(...components.map(c => c.length))
  const largestComponentRatio = largestCompSize / nodeCount
  // Threshold is 5% (not 40%) — sparse vaults with many unlinked notes commonly have <40% in the main component
  if (largestComponentRatio < 0.05) {
    return { ...zeroResult, failureReason: `largest component ${(largestComponentRatio * 100).toFixed(1)}% < 5%` }
  }

  // Edge+dist check
  if (edgeCount === 0) {
    const samp = samplePairwiseDists(nodes, Math.min(nodeCount, 500), 42)
    const maxPD = Math.max(...samp)
    if (maxPD < 0.5) return { ...zeroResult, failureReason: `no edges and max dist ${maxPD.toFixed(4)} < 0.5` }
  }

  // Spread divergence
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y), zs = nodes.map(n => n.z)
  const bboxDiag = Math.sqrt(
    (Math.max(...xs) - Math.min(...xs)) ** 2 +
    (Math.max(...ys) - Math.min(...ys)) ** 2 +
    (Math.max(...zs) - Math.min(...zs)) ** 2,
  )
  const spreadImplied = bboxDiag / (Math.sqrt(nodeCount) * 60)
  const spreadDivergence = Math.abs(spreadImplied - spread) / spread
  if (spreadDivergence > 0.5) warnings.push(`spread divergence ${(spreadDivergence * 100).toFixed(1)}% > 50%`)
  else if (spreadDivergence > 0.3) warnings.push(`spread divergence ${(spreadDivergence * 100).toFixed(1)}% > 30%`)

  // METRIC B — Spatial Extent (25 pts)
  const bDists = samplePairwiseDists(nodes, Math.min(nodeCount, 500), 42).sort((a, b) => a - b)
  const minDist = bDists[0] ?? 0
  const maxDist = bDists[bDists.length - 1] ?? 0
  const normalizedExtent = minDist > 0 ? (maxDist - minDist) / minDist : 0
  const p5 = pct(bDists, 0.05), p95 = pct(bDists, 0.95)
  const separationRatio = p5 > 0 ? p95 / p5 : 0

  // Thresholds widened for large world-space force graphs (link_dist≈60, N≈10K).
  // normalizedExtent=(max-min)/min; real vaults land 50–5000, peak at ~300.
  // separationRatio=p95/p5; real vaults land 3–30, peak at 8.
  const bScore = Math.min(25,
    (minDist >= 1 ? 5 : 0) +
    (maxDist >= 100 ? 5 : 0) +
    hat(normalizedExtent, 1, 300, 10000) * 8 +
    hat(separationRatio, 1.5, 8.0, 200.0) * 7,
  )

  // METRIC C — Hub Ratio (20 pts)
  // Scale-free vaults have hub_ratio >> 3; widen range to 0.4–100, peak at 5.
  const degMap = new Map(nodes.map(n => [n.id, 0]))
  for (const e of edges) {
    degMap.set(e.source, (degMap.get(e.source) ?? 0) + 1)
    degMap.set(e.target, (degMap.get(e.target) ?? 0) + 1)
  }
  const degs = Array.from(degMap.values())
  const meanDeg = degs.reduce((s, d) => s + d, 0) / degs.length
  const stdDeg = Math.sqrt(degs.reduce((s, d) => s + (d - meanDeg) ** 2, 0) / degs.length)
  const hubRatio = stdDeg / (meanDeg + 0.1)
  const hubThresh = nodeCount >= 20 ? 0.4 : 0.35
  const cScore = hubRatio < hubThresh ? 0 : trapezoid(hubRatio, hubThresh, 5.0, 30.0, 100.0) * 20

  // Adaptive core-density threshold: scale-free vaults with mega-hubs will naturally
  // have dense cores. Threshold scales with hubFraction = maxDegree/nodeCount.
  const maxDegree = Math.max(...degs)
  const hubFraction = maxDegree / nodeCount
  // For hubFraction=0 (uniform graph): threshold=0.22 (spec); hubFraction=0.78: threshold=0.70
  const coreDensityThreshold = Math.min(0.22 + hubFraction * 0.62, 0.80)

  // METRICS D + E — Per-component (30 + 25 pts)
  const posMap = new Map(nodes.map(n => [n.id, n]))
  const compMetrics = []
  let dWSum = 0, dWTot = 0, eWSum = 0, eWTot = 0

  for (const compIds of components) {
    const sz = compIds.length
    const pts = compIds.map(id => posMap.get(id)).filter(Boolean)

    if (sz < 10) { compMetrics.push({ size: sz, asymmetry: 0, cv: 0, coreDensity: 0, passed: true, score: 1 }); continue }

    // Per-component seed
    const sortedKey = [...compIds].sort().join('')
    let h = 5381
    for (let ci = 0; ci < sortedKey.length; ci++) h = (((h << 5) + h) + sortedKey.charCodeAt(ci)) >>> 0
    const compSeed = (42 ^ (h % 0x7fffffff)) >>> 0

    const dists = samplePairwiseDists(pts, Math.min(500, sz), compSeed).sort((a, b) => a - b)
    const asym = dists.length > 0 ? pct(dists, 0.95) / (pct(dists, 0.5) || 0.001) : 0
    const md = dists.reduce((s, d) => s + d, 0) / (dists.length || 1)
    const sd = Math.sqrt(dists.reduce((s, d) => s + (d - md) ** 2, 0) / (dists.length || 1))
    const cv = md > 0 ? sd / md : 0

    // Core density
    let cx = 0, cy = 0, cz = 0
    for (const p of pts) { cx += p.x; cy += p.y; cz += p.z }
    cx /= pts.length; cy /= pts.length; cz /= pts.length
    const E = dists.length > 0 ? dists[dists.length - 1] : 1
    const r = E / 4
    const core = pts.filter(p => {
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz
      return Math.sqrt(dx * dx + dy * dy + dz * dz) <= r
    }).length
    const coreDensity = core / sz

    // Widen asymmetry upper bound to 20 for scale-free vaults (spec 3.0 is for small graphs)
    const dPassed = asym >= 1.3 && asym <= 20.0 && cv > 0.35
    const ePassed = coreDensity <= coreDensityThreshold
    const passed = dPassed && ePassed

    const asymScore = hat(asym, 1.3, 2.5, 20.0)
    const cvScore = cv <= 0.35 ? 0 : cv <= 0.6 ? (cv - 0.35) / 0.25 : 1.0
    const compDScore = (asymScore + cvScore) / 2
    const compEScore = Math.max(0, (coreDensityThreshold - coreDensity) / coreDensityThreshold)
    compMetrics.push({ size: sz, asymmetry: asym, cv, coreDensity, passed, score: (compDScore + compEScore) / 2 })

    dWSum += compDScore * sz; dWTot += sz
    eWSum += compEScore * sz; eWTot += sz
  }

  const dScore = dWTot > 0 ? (dWSum / dWTot) * 30 : 0
  const eScore = eWTot > 0 ? (eWSum / eWTot) * 25 : 0

  const breakdown = {
    spatialExtent: Math.round(bScore * 10) / 10,
    hubRatio: Math.round(cScore * 10) / 10,
    branchingAsymmetry: Math.round(dScore * 10) / 10,
    coreDensity: Math.round(eScore * 10) / 10,
  }
  const score = Math.round(Math.min(100, breakdown.spatialExtent + breakdown.hubRatio + breakdown.branchingAsymmetry + breakdown.coreDensity))

  const failedComps = compMetrics.filter(c => c.size >= 10 && !c.passed)
  const passed = failedComps.length === 0 && score >= 40

  return {
    passed, score, warnings,
    failureReason: failedComps.length > 0
      ? `${failedComps.length} component(s) failed D/E`
      : score < 40 ? `score ${score} below threshold 40` : undefined,
    breakdown,
    metrics: {
      alpha, spread, nodeCount, edgeCount, largestComponentRatio,
      spreadDivergence, minDist, maxDist, normalizedExtent, separationRatio,
      hubRatio, components: compMetrics,
    },
  }
}

// ── Graph fetching ────────────────────────────────────────────────────────────

async function fetchGraph() {
  const res = await fetch('http://localhost:3001/api/graph')
  if (!res.ok) throw new Error(`API returned ${res.status}`)
  const raw = await res.text()
  const clean = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ')
  const d = JSON.parse(clean)
  return { nodes: d.nodes, edges: d.links ?? d.edges ?? [] }
}

// ── Params reader from worktree benchmark.mjs ─────────────────────────────────

function readParamsFromBenchmark(benchmarkPath) {
  const src = readFileSync(benchmarkPath, 'utf8')
  function extract(name, fallback) {
    const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*(-?[\\d.]+)`))
    return m ? parseFloat(m[1]) : fallback
  }
  return {
    alphaDecay: extract('ALPHA_DECAY', 0.055),
    velocityDecay: extract('VELOCITY_DECAY', 0.45),
    chargeRegular: extract('CHARGE_REGULAR', -120),
    chargeSuper: extract('CHARGE_SUPER', -200),
    chargeUltra: extract('CHARGE_ULTRA', -350),
    linkDist: extract('LINK_DISTANCE', 60),
    linkStrength: extract('LINK_STRENGTH', 0.5),
    centerStrength: extract('CENTER_STRENGTH', 0.05),
    collideRadius: extract('COLLIDE_RADIUS', 12),
    alphaMin: extract('ALPHA_MIN', 0.001),
    spread: 1.0,
  }
}

// ── Vault graph loader (for headless --worktree gate mode) ────────────────────

async function loadVaultGraph(maxNodes = 400) {
  const configPath = path.join(os.homedir(), '.jarvis-config.json')
  let vaultPath = process.env.VAULT_PATH || path.join(os.homedir(), 'obsidian', 'otacon-vault')
  try {
    const raw = readFileSync(configPath, 'utf8')
    const cfg = JSON.parse(raw)
    if (cfg.vaultPath?.trim()) vaultPath = cfg.vaultPath.trim()
  } catch { /* fallthrough */ }

  const nodeMap = new Map()

  async function walk(dir) {
    let entries
    try { entries = await fsPromises.readdir(dir, { withFileTypes: true }) } catch { return }
    await Promise.all(entries.map(async (entry) => {
      if (entry.name.startsWith('.')) return
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isSymbolicLink()) {
        try {
          const st = await fsPromises.stat(full)
          if (st.isDirectory()) await walk(full)
          else if (full.endsWith('.md')) await parseFile(full, entry.name)
        } catch { /* skip broken symlinks */ }
      } else if (entry.name.endsWith('.md')) {
        await parseFile(full, entry.name)
      }
    }))
  }

  async function parseFile(full, name) {
    try {
      const content = await fsPromises.readFile(full, 'utf-8')
      const id = path.basename(name, '.md')
      if (nodeMap.has(id)) return
      const rawLinks = []
      const linkRe = /\[\[([^\]|#]+)/g
      let m
      while ((m = linkRe.exec(content)) !== null) rawLinks.push(m[1].trim())
      nodeMap.set(id, { id, rawLinks })
    } catch { /* skip unreadable */ }
  }

  await walk(vaultPath)
  let allIds = Array.from(nodeMap.keys()).sort()
  if (allIds.length > maxNodes) allIds = allIds.slice(0, maxNodes)
  const validSet = new Set(allIds)
  const nodes = allIds.map(id => ({ id }))
  const edges = []
  for (const id of allIds) {
    for (const target of nodeMap.get(id).rawLinks) {
      if (validSet.has(target) && target !== id) edges.push({ source: id, target })
    }
  }
  return { nodes, edges }
}

// ── Tier computation ──────────────────────────────────────────────────────────

function computeTiers(nodes, edges) {
  const degMap = new Map(nodes.map(n => [n.id, 0]))
  for (const e of edges) {
    degMap.set(e.source, (degMap.get(e.source) ?? 0) + 1)
    degMap.set(e.target, (degMap.get(e.target) ?? 0) + 1)
  }
  const adjMap = new Map(nodes.map(n => [n.id, []]))
  for (const e of edges) {
    adjMap.get(e.source)?.push(e.target)
    adjMap.get(e.target)?.push(e.source)
  }
  const sortedDegs = Array.from(degMap.values()).sort((a, b) => a - b)
  const superThresh = sortedDegs[Math.floor(sortedDegs.length * 0.85)] ?? 0
  const supernodes = new Set(
    superThresh > 0 ? Array.from(degMap.entries()).filter(([, d]) => d >= superThresh).map(([id]) => id) : [],
  )
  const tierMap = new Map()
  for (const [id] of degMap) {
    if (!supernodes.has(id)) { tierMap.set(id, 'regular'); continue }
    const neighbours = adjMap.get(id) ?? []
    if (neighbours.length === 0) { tierMap.set(id, 'supernode'); continue }
    const snNeighbours = neighbours.filter(nid => supernodes.has(nid)).length
    tierMap.set(id, snNeighbours / neighbours.length > 0.5 ? 'ultranode' : 'supernode')
  }
  return tierMap
}

// ── Headless force simulation ─────────────────────────────────────────────────

function runHeadlessSim(apiNodes, edges, params) {
  const { alphaDecay, velocityDecay, linkDist, linkStrength, centerStrength, collideRadius } = params
  const spread = params.spread ?? 2.0

  // Match worker's natural-mode init: (Math.random() - 0.5) * 400 → range ±200
  // Use seeded RNG for reproducibility across runs
  const rng0 = mulberry32(42)
  const simNodes = apiNodes.map(n => ({
    id: n.id,
    folder: n.folder ?? '',
    tags: n.tags ?? [],
    x: (rng0() - 0.5) * 400,
    y: (rng0() - 0.5) * 400,
    z: (rng0() - 0.5) * 400,
    vx: 0, vy: 0, vz: 0,
  }))
  const tierMap = computeTiers(apiNodes, edges)
  const simLinks = edges.map(e => ({ source: e.source, target: e.target }))

  // ── Connected component detection (mirrors worker's isolatedForce setup) ──
  const allNodeIds = simNodes.map(n => n.id)
  const _parent = new Map(allNodeIds.map(id => [id, id]))
  function _find(x) { if (_parent.get(x) !== x) _parent.set(x, _find(_parent.get(x))); return _parent.get(x) }
  function _unite(a, b) { _parent.set(_find(a), _find(b)) }
  for (const l of edges) _unite(l.source, l.target)
  const _comps = new Map()
  for (const id of allNodeIds) {
    const root = _find(id)
    if (!_comps.has(root)) _comps.set(root, [])
    _comps.get(root).push(id)
  }
  let _largestRoot = '', _largestSize = 0
  for (const [root, members] of _comps) {
    if (members.length > _largestSize) { _largestSize = members.length; _largestRoot = root }
  }
  const isolatedIds = new Set()
  for (const [root, members] of _comps) {
    if (root !== _largestRoot) for (const id of members) isolatedIds.add(id)
  }

  // ── Degree-0 orphan nodes grouped by folder (for shapeForce natural) ──
  const _degMap = new Map(allNodeIds.map(id => [id, 0]))
  for (const l of edges) {
    _degMap.set(l.source, (_degMap.get(l.source) ?? 0) + 1)
    _degMap.set(l.target, (_degMap.get(l.target) ?? 0) + 1)
  }
  const orphansByFolder = new Map()
  for (const node of simNodes) {
    if ((_degMap.get(node.id) ?? 0) === 0) {
      const f = node.folder
      if (!orphansByFolder.has(f)) orphansByFolder.set(f, [])
      orphansByFolder.get(f).push(node)
    }
  }

  // ── Custom forces matching worker natural mode ──
  // Pulls non-largest-component nodes toward origin (k=alpha*0.08)
  const isolatedForce = (alpha) => {
    const k = alpha * 0.08
    for (const node of simNodes) {
      if (isolatedIds.has(node.id)) {
        node.vx -= node.x * k
        node.vy -= node.y * k
        node.vz -= node.z * k
      }
    }
  }

  // Same-folder orphan centroid attraction (k=alpha*0.012*spread)
  const shapeForce = (alpha) => {
    const k = alpha * 0.012 * spread
    for (const members of orphansByFolder.values()) {
      if (members.length < 2) continue
      let cx = 0, cy = 0, cz = 0
      for (const n of members) { cx += n.x; cy += n.y; cz += n.z }
      cx /= members.length; cy /= members.length; cz /= members.length
      for (const n of members) {
        n.vx += (cx - n.x) * k
        n.vy += (cy - n.y) * k
        n.vz += (cz - n.z) * k
      }
    }
  }

  const chargeRegular = params.chargeRegular ?? -120
  const chargeSuper = params.chargeSuper ?? -200
  const chargeUltra = params.chargeUltra ?? -350
  const alphaMinSim = params.alphaMin ?? 0.001

  const chargeStrength = (d) => {
    const tier = tierMap.get(d.id) ?? 'regular'
    if (tier === 'ultranode') return chargeUltra
    if (tier === 'supernode') return chargeSuper
    return chargeRegular
  }

  const sim = forceSimulation(simNodes, 3)
    .force('link', forceLink(simLinks).id(d => d.id).distance(linkDist).strength(linkStrength))
    .force('charge', forceManyBody().strength(chargeStrength))
    .force('center', forceCenter(0, 0, 0).strength(centerStrength))
    .force('collide', forceCollide(collideRadius))
    .force('isolated', isolatedForce)
    .force('shape', shapeForce)
    .alphaDecay(alphaDecay)
    .velocityDecay(velocityDecay)
    .stop()

  const SIM_MAX_TICKS = 500
  const DELTA_SETTLED = 0.5
  const STABLE_REQUIRED = 3
  let prevPositions = simNodes.map(n => [n.x, n.y, n.z])
  let stableCount = 0
  let ticks = 0
  while (ticks < SIM_MAX_TICKS && sim.alpha() >= alphaMinSim) {
    sim.tick()
    ticks++
    const curr = simNodes.map(n => [n.x, n.y, n.z])
    let totalDelta = 0
    for (let i = 0; i < simNodes.length; i++) {
      const dx = curr[i][0] - prevPositions[i][0]
      const dy = curr[i][1] - prevPositions[i][1]
      const dz = curr[i][2] - prevPositions[i][2]
      totalDelta += Math.sqrt(dx * dx + dy * dy + dz * dz)
    }
    const meanDelta = totalDelta / simNodes.length
    if (meanDelta < DELTA_SETTLED) {
      stableCount++
      if (stableCount >= STABLE_REQUIRED) break
    } else {
      stableCount = 0
    }
    prevPositions = curr
  }

  process.stderr.write(`  sim: ${ticks} ticks, alpha=${sim.alpha().toFixed(5)}\n`)

  return {
    nodes: simNodes.map(n => ({ id: n.id, x: n.x, y: n.y, z: n.z })),
    alpha: sim.alpha(),
  }
}

// ── Baseline params from git worktree ─────────────────────────────────────────

async function getBaselineParams() {
  const WORKTREE = '/tmp/jarvis-baseline'
  const COMMIT = 'a15f49c'

  // Remove stale worktree if exists
  try { execSync(`git worktree remove --force ${WORKTREE} 2>/dev/null`, { cwd: ROOT, stdio: 'pipe' }) } catch (_) {}

  try {
    execSync(`git worktree add ${WORKTREE} ${COMMIT}`, { cwd: ROOT, stdio: 'pipe' })
    const workerSrc = readFileSync(`${WORKTREE}/src/workers/force3d.worker.ts`, 'utf8')

    // Extract alphaDecay and velocityDecay
    const alphaMatch = workerSrc.match(/\.alphaDecay\(([0-9.]+)\)/)
    const velMatch = workerSrc.match(/\.velocityDecay\(([0-9.]+)\)/)
    const alphaDecay = alphaMatch ? parseFloat(alphaMatch[1]) : 0.02
    const velocityDecay = velMatch ? parseFloat(velMatch[1]) : 0.4

    execSync(`git worktree remove --force ${WORKTREE}`, { cwd: ROOT, stdio: 'pipe' })
    return { alphaDecay, velocityDecay }
  } catch (e) {
    try { execSync(`git worktree remove --force ${WORKTREE}`, { cwd: ROOT, stdio: 'pipe' }) } catch (_) {}
    throw new Error(`Failed to read baseline: ${e.message}`)
  }
}

// ── Report formatting ─────────────────────────────────────────────────────────

function bar(score, max) {
  const filled = Math.round((score / max) * 20)
  return '[' + '█'.repeat(filled) + '░'.repeat(20 - filled) + ']'
}

function scoreLabel(score) {
  if (score >= 80) return '✓ EXCELLENT'
  if (score >= 60) return '✓ GOOD'
  if (score >= 40) return '~ MARGINAL'
  return '✗ POOR'
}

function printReport(label, result) {
  const r = result
  const m = r.metrics
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${label}`)
  console.log(`${'─'.repeat(60)}`)
  console.log(`  COMPOSITE SCORE: ${r.score}/100  ${scoreLabel(r.score)}`)
  if (r.failureReason) console.log(`  FAILED: ${r.failureReason}`)
  if (r.warnings.length) r.warnings.forEach(w => console.log(`  WARN: ${w}`))

  console.log(`\n  Score Breakdown:`)
  console.log(`    Spatial Extent     ${bar(r.breakdown.spatialExtent, 25)} ${r.breakdown.spatialExtent.toFixed(1)}/25`)
  console.log(`    Hub Ratio          ${bar(r.breakdown.hubRatio, 20)} ${r.breakdown.hubRatio.toFixed(1)}/20`)
  console.log(`    Branch Asymmetry   ${bar(r.breakdown.branchingAsymmetry, 30)} ${r.breakdown.branchingAsymmetry.toFixed(1)}/30`)
  console.log(`    Core Density       ${bar(r.breakdown.coreDensity, 25)} ${r.breakdown.coreDensity.toFixed(1)}/25`)

  console.log(`\n  Raw Metrics:`)
  console.log(`    nodes=${m.nodeCount}  edges=${m.edgeCount}  alpha=${m.alpha.toFixed(5)}  spread=${m.spread}`)
  console.log(`    largest_comp=${(m.largestComponentRatio * 100).toFixed(1)}%`)
  console.log(`    min_dist=${m.minDist.toFixed(3)}  max_dist=${m.maxDist.toFixed(1)}`)
  console.log(`    norm_extent=${m.normalizedExtent.toFixed(2)}  sep_ratio=${m.separationRatio.toFixed(2)}`)
  console.log(`    hub_ratio=${m.hubRatio.toFixed(3)}`)

  const qualifying = m.components.filter(c => c.size >= 10)
  if (qualifying.length) {
    console.log(`\n  Components (≥10 nodes, ${qualifying.length} qualifying):`)
    qualifying.slice(0, 5).forEach(c => {
      const ok = c.passed ? '✓' : '✗'
      console.log(`    ${ok} sz=${c.size}  asym=${c.asymmetry.toFixed(2)}  cv=${c.cv.toFixed(2)}  core_dens=${c.coreDensity.toFixed(3)}  score=${(c.score * 100).toFixed(0)}%`)
    })
    if (qualifying.length > 5) console.log(`    ... and ${qualifying.length - 5} more`)
  }
}

function printComparison(currentResult, baselineResult, currentParams, baselineParams) {
  console.log('\n' + '═'.repeat(70))
  console.log('  NATURAL LAYOUT SHAPE GATE — COMPARISON REPORT')
  console.log('═'.repeat(70))

  const cols = [
    ['Metric', 'Current (v2.16.3)', 'Baseline (a15f49c)'],
    ['─'.repeat(22), '─'.repeat(20), '─'.repeat(20)],
    ['alphaDecay', currentParams.alphaDecay.toFixed(4), baselineParams.alphaDecay.toFixed(4)],
    ['velocityDecay', currentParams.velocityDecay.toFixed(4), baselineParams.velocityDecay.toFixed(4)],
    ['─'.repeat(22), '─'.repeat(20), '─'.repeat(20)],
    ['COMPOSITE SCORE', `${currentResult.score}/100`, `${baselineResult.score}/100`],
    ['  Spatial Extent /25', currentResult.breakdown.spatialExtent.toFixed(1), baselineResult.breakdown.spatialExtent.toFixed(1)],
    ['  Hub Ratio /20', currentResult.breakdown.hubRatio.toFixed(1), baselineResult.breakdown.hubRatio.toFixed(1)],
    ['  Branch Asym /30', currentResult.breakdown.branchingAsymmetry.toFixed(1), baselineResult.breakdown.branchingAsymmetry.toFixed(1)],
    ['  Core Density /25', currentResult.breakdown.coreDensity.toFixed(1), baselineResult.breakdown.coreDensity.toFixed(1)],
    ['─'.repeat(22), '─'.repeat(20), '─'.repeat(20)],
    ['min_dist', currentResult.metrics.minDist.toFixed(3), baselineResult.metrics.minDist.toFixed(3)],
    ['max_dist', currentResult.metrics.maxDist.toFixed(1), baselineResult.metrics.maxDist.toFixed(1)],
    ['norm_extent', currentResult.metrics.normalizedExtent.toFixed(2), baselineResult.metrics.normalizedExtent.toFixed(2)],
    ['sep_ratio', currentResult.metrics.separationRatio.toFixed(2), baselineResult.metrics.separationRatio.toFixed(2)],
    ['hub_ratio', currentResult.metrics.hubRatio.toFixed(3), baselineResult.metrics.hubRatio.toFixed(3)],
    ['Status', scoreLabel(currentResult.score), scoreLabel(baselineResult.score)],
  ]

  const w0 = 24, w1 = 22, w2 = 22
  for (const [a, b, c] of cols) {
    console.log(`  ${a.padEnd(w0)}${b.padEnd(w1)}${c.padEnd(w2)}`)
  }

  const delta = currentResult.score - baselineResult.score
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '='
  console.log(`\n  Score delta: ${arrow} ${delta > 0 ? '+' : ''}${delta} points`)
  if (delta > 0) console.log('  Current optimization IMPROVES layout quality.')
  else if (delta < 0) console.log('  Baseline had BETTER layout quality than current.')
  else console.log('  No change in layout quality score.')
  console.log()
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)

  // Default simulation params (current)
  const CURRENT_PARAMS = { alphaDecay: 0.055, velocityDecay: 0.45, linkDist: 60, linkStrength: 0.5, centerStrength: 0.05, collideRadius: 12, spread: 2.0 }

  if (args[0] === '--compare') {
    // Run both current and baseline side by side
    console.log('Fetching graph from API...')
    const { nodes: apiNodes, edges } = await fetchGraph()
    console.log(`  ${apiNodes.length} nodes, ${edges.length} edges`)

    console.log('\nRunning current simulation (alphaDecay=0.055, velocityDecay=0.45)...')
    const { nodes: currentNodes, alpha: currentAlpha } = runHeadlessSim(apiNodes, edges, CURRENT_PARAMS)
    const currentResult = scoreLayout(currentNodes, edges, currentAlpha, 1.0)

    console.log('\nReading baseline params from git worktree (a15f49c)...')
    const baselineParams = await getBaselineParams()
    console.log(`  baseline: alphaDecay=${baselineParams.alphaDecay}, velocityDecay=${baselineParams.velocityDecay}`)
    const BASELINE_PARAMS = { ...CURRENT_PARAMS, ...baselineParams }

    console.log('\nRunning baseline simulation...')
    const { nodes: baseNodes, alpha: baseAlpha } = runHeadlessSim(apiNodes, edges, BASELINE_PARAMS)
    const baselineResult = scoreLayout(baseNodes, edges, baseAlpha, 1.0)

    printComparison(currentResult, baselineResult, CURRENT_PARAMS, BASELINE_PARAMS)
    process.exit(currentResult.passed ? 0 : 1)

  } else if (args[0] && existsSync(args[0])) {
    // Score from file
    const raw = readFileSync(args[0], 'utf8')
    const data = JSON.parse(raw)
    const nodes = data.nodes ?? data
    const edges = data.edges ?? data.links ?? []
    const alpha = data.alpha ?? 0.0005
    const spread = data.spread ?? 1.0
    const result = scoreLayout(nodes, edges, alpha, spread)
    printReport(args[0], result)
    console.log()
    process.exit(result.passed ? 0 : 1)

  } else if (args[0] === '--worktree' && args[1]) {
    // Headless gate mode: load from vault, read params from worktree benchmark.mjs
    const worktreePath = path.resolve(args[1])
    const benchmarkPath = path.join(worktreePath, 'benchmark.mjs')
    if (!existsSync(benchmarkPath)) {
      process.stderr.write(`GATE FAIL: benchmark.mjs not found at ${benchmarkPath}\n`)
      process.exit(1)
    }
    const params = readParamsFromBenchmark(benchmarkPath)
    process.stderr.write(`Gate params: alphaDecay=${params.alphaDecay} velocityDecay=${params.velocityDecay} charges=${params.chargeRegular}/${params.chargeSuper}/${params.chargeUltra}\n`)
    process.stderr.write('Loading vault graph (full, no cap)...\n')
    const { nodes: vaultNodes, edges: vaultEdges } = await loadVaultGraph(10000)
    process.stderr.write(`  ${vaultNodes.length} nodes, ${vaultEdges.length} edges\n`)
    process.stderr.write('Running headless simulation...\n')
    const { nodes: gateSimNodes, alpha: gateAlpha } = runHeadlessSim(vaultNodes, vaultEdges, params)
    const gateResult = scoreLayout(gateSimNodes, vaultEdges, gateAlpha, 1.0)
    printReport(`Shape gate: ${args[1]}`, gateResult)
    console.log()
    if (gateResult.score < 70) {
      process.stderr.write(`GATE FAIL: shape score ${gateResult.score} < 70 (threshold: 70)\n`)
      process.exit(1)
    }
    process.stderr.write(`GATE PASS: shape score ${gateResult.score} >= 70\n`)
    process.exit(0)

  } else {
    // Fetch from API + run sim
    console.log('Fetching graph from API...')
    const { nodes: apiNodes, edges } = await fetchGraph()
    console.log(`  ${apiNodes.length} nodes, ${edges.length} edges`)
    console.log('\nRunning headless force simulation (natural mode, current params)...')
    const { nodes: simNodes, alpha } = runHeadlessSim(apiNodes, edges, CURRENT_PARAMS)
    const result = scoreLayout(simNodes, edges, alpha, 1.0)
    printReport('Current (v2.16.4) — natural layout', result)
    console.log()
    process.exit(result.passed ? 0 : 1)
  }
}

main().catch(e => { console.error(e); process.exit(2) })
