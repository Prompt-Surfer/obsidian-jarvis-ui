import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from 'd3-force-3d'

interface WorkerNode {
  id: string
  folder: string
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  [key: string]: unknown
}

interface WorkerLink {
  source: string | WorkerNode
  target: string | WorkerNode
}

type WorkerSimulation = ReturnType<typeof forceSimulation>

let simulation: WorkerSimulation | null = null
let simNodes: WorkerNode[] = []
let tickCount = 0
let tickRunning = false
const MAX_TICKS = 200   // 300→200: practical convergence happens well before 300 ticks
const ALPHA_MIN = 0.001 // early-exit threshold
let graphShape: 'centroid' | 'saturn' | 'milkyway' = 'centroid'
let currentSpread = 2.0

function getNodePositions(nodes: WorkerNode[]) {
  return nodes.map(n => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 }))
}

function runTick() {
  // Stop when max ticks reached OR simulation has converged (alpha below threshold)
  if (!simulation || tickCount >= MAX_TICKS || simulation.alpha() < ALPHA_MIN) {
    tickRunning = false
    self.postMessage({ type: 'end', nodes: getNodePositions(simNodes), tickCount })
    return
  }
  tickRunning = true
  simulation.tick()
  tickCount++

  if (tickCount % 5 === 0 || tickCount === 1) {
    self.postMessage({
      type: 'tick',
      nodes: getNodePositions(simNodes),
      tickCount,
      alpha: simulation.alpha(),
      firstTick: tickCount === 1,
    })
  }

  setTimeout(runTick, 0)
}

self.onmessage = (e: MessageEvent) => {
  const { type, nodes, links } = e.data as {
    type: string
    nodes?: Array<{ id: string; folder: string }>
    links?: Array<{ source: string; target: string }>
    graphShape?: 'centroid' | 'saturn' | 'milkyway'
  }

  if (type === 'setGraphShape') {
    graphShape = (e.data as { graphShape?: 'centroid' | 'saturn' | 'milkyway' }).graphShape ?? 'centroid'
    // Reheat sim so nodes animate to new shape
    if (simulation) {
      tickCount = 0
      simulation.alpha(0.6)
      if (!tickRunning) runTick()
    }
    return
  }

  // Pin nodes at specific positions (drag start)
  if (type === 'pinNodes') {
    const pinned = (e.data as { pinned?: Array<{ id: string; x: number; y: number; z: number }> }).pinned ?? []
    for (const p of pinned) {
      const node = simNodes.find(n => n.id === p.id)
      if (node) { node.fx = p.x; node.fy = p.y; node.fz = p.z; node.x = p.x; node.y = p.y; node.z = p.z }
    }
    if (simulation) {
      tickCount = 0; simulation.alpha(0.4)
      if (!tickRunning) runTick()
    }
    self.postMessage({ type: 'tick', nodes: getNodePositions(simNodes), tickCount, alpha: simulation?.alpha() ?? 0 })
    return
  }

  // Move pinned node during drag — keep sim hot so connected nodes actively follow
  if (type === 'moveNodes') {
    const pinned = (e.data as { pinned?: Array<{ id: string; x: number; y: number; z: number }> }).pinned ?? []
    for (const p of pinned) {
      const node = simNodes.find(n => n.id === p.id)
      if (node) { node.fx = p.x; node.fy = p.y; node.fz = p.z; node.x = p.x; node.y = p.y; node.z = p.z }
    }
    // Reheat each move so connected nodes keep following (alpha never decays to 0 during drag)
    if (simulation) {
      if (simulation.alpha() < 0.25) simulation.alpha(0.35)
      if (!tickRunning) { tickCount = 0; runTick() }
    }
    self.postMessage({ type: 'tick', nodes: getNodePositions(simNodes), tickCount, alpha: simulation?.alpha() ?? 0 })
    return
  }

  // Clear ALL pinned nodes (Reset All) — let sim find new natural equilibrium
  if (type === 'resetPins') {
    for (const node of simNodes) {
      delete node.fx; delete node.fy; delete node.fz
      node.vx = 0; node.vy = 0; node.vz = 0
    }
    if (simulation) {
      tickCount = 0; simulation.alpha(0.6)
      if (!tickRunning) runTick()
    }
    return
  }

  // Finalise drag — keep fx/fy/fz pinned at dropped position; reheat lightly so surrounding nodes settle
  if (type === 'unpinNodes') {
    const ids = (e.data as { ids?: string[] }).ids ?? []
    for (const id of ids) {
      const node = simNodes.find(n => n.id === id)
      // Keep fx/fy/fz — node stays at dropped position; only zero velocity
      if (node) { node.vx = 0; node.vy = 0; node.vz = 0 }
    }
    if (simulation) {
      simulation.alpha(0.12)
      if (!tickRunning) { tickCount = 0; runTick() }
    }
    return
  }

  if (type === 'init') {
    tickRunning = false
    tickCount = 0
    if (e.data.graphShape) graphShape = e.data.graphShape
    if (e.data.spread != null) currentSpread = e.data.spread

    // Warm restart: if existing positions are provided (shape-only change), reuse them
    // so nodes start near their previous locations instead of random scatter
    const warmPositions = new Map<string, { x: number; y: number; z: number }>()
    if (e.data.existingPositions) {
      for (const p of e.data.existingPositions as Array<{ id: string; x: number; y: number; z: number }>) {
        warmPositions.set(p.id, { x: p.x, y: p.y, z: p.z })
      }
    }

    simNodes = (nodes ?? []).map((n) => {
      const warm = warmPositions.get(n.id)
      return {
        id: n.id,
        folder: n.folder,
        x: warm?.x ?? (Math.random() - 0.5) * 400,
        y: warm?.y ?? (Math.random() - 0.5) * 400,
        z: warm?.z ?? (Math.random() - 0.5) * 400,
        vx: 0,
        vy: 0,
        vz: 0,
      }
    })

    const simLinks: WorkerLink[] = (links ?? []).map(l => ({
      source: l.source,
      target: l.target,
    }))

    // Compute connected components via union-find to identify isolated sub-clusters
    const allNodeIds = simNodes.map(n => n.id)
    const parent = new Map<string, string>()
    for (const id of allNodeIds) parent.set(id, id)

    function find(x: string): string {
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
      return parent.get(x)!
    }
    function unite(a: string, b: string) { parent.set(find(a), find(b)) }
    for (const l of links ?? []) unite(l.source, l.target)

    // Group by component root, find largest
    const components = new Map<string, string[]>()
    for (const id of allNodeIds) {
      const root = find(id)
      if (!components.has(root)) components.set(root, [])
      components.get(root)!.push(id)
    }
    let largestRoot = ''
    let largestSize = 0
    for (const [root, members] of components) {
      if (members.length > largestSize) { largestSize = members.length; largestRoot = root }
    }

    // All nodes NOT in the largest component (orphans + isolated sub-clusters)
    const isolatedIds = new Set<string>()
    for (const [root, members] of components) {
      if (root !== largestRoot) for (const id of members) isolatedIds.add(id)
    }

    // Radial pull toward origin for isolated nodes (0.08 = moderate, tunable)
    const isolatedForce = (alpha: number) => {
      const k = alpha * 0.08
      for (const node of simNodes) {
        if (isolatedIds.has(node.id)) {
          node.vx -= node.x * k
          node.vy -= node.y * k
          node.vz -= node.z * k
        }
      }
    }

    // Identify degree-0 orphan nodes (no links at all)
    const degreeMap = new Map<string, number>()
    for (const id of allNodeIds) degreeMap.set(id, 0)
    for (const l of links ?? []) {
      degreeMap.set(l.source, (degreeMap.get(l.source) ?? 0) + 1)
      degreeMap.set(l.target, (degreeMap.get(l.target) ?? 0) + 1)
    }
    // Collect all degree-0 orphan nodes sorted deterministically by id
    const allOrphans: WorkerNode[] = simNodes
      .filter(n => (degreeMap.get(n.id) ?? 0) === 0)
      .sort((a, b) => a.id.localeCompare(b.id))

    // Group orphan nodes by folder (used by centroid affinity force)
    const orphansByFolder = new Map<string, WorkerNode[]>()
    for (const node of allOrphans) {
      const f = node.folder
      if (!orphansByFolder.has(f)) orphansByFolder.set(f, [])
      orphansByFolder.get(f)!.push(node)
    }

    // All connected nodes grouped by component, sorted by component size (largest first)
    const connectedNodeIds = new Set<string>()
    for (const [id, deg] of degreeMap) {
      if (deg > 0) connectedNodeIds.add(id)
    }
    const allClusters: string[][] = []
    for (const [, members] of components) {
      const connected = members.filter(id => connectedNodeIds.has(id))
      if (connected.length > 0) allClusters.push(connected)
    }
    allClusters.sort((a, b) => b.length - a.length)
    const connectedCount = allClusters.reduce((sum, c) => sum + c.length, 0)

    // ── Saturn target positions ─────────────────────────────────────────────
    const saturnTargets = new Map<string, { x: number; y: number; z: number }>()

    {
      const R_base = 150 + Math.sqrt(connectedCount) * 3
      const goldenAngle = Math.PI * (3 - Math.sqrt(5))  // ~2.399 rad

      // Planet body: single-radius Fibonacci sphere — clean spherical shell
      const allConnectedFlat: string[] = []
      for (const cluster of allClusters) {
        for (const nodeId of cluster) allConnectedFlat.push(nodeId)
      }

      for (let i = 0; i < allConnectedFlat.length; i++) {
        const nodeId = allConnectedFlat[i]
        const phi = Math.acos(1 - 2 * (i + 0.5) / allConnectedFlat.length)
        const theta = i * goldenAngle

        saturnTargets.set(nodeId, {
          x: R_base * Math.sin(phi) * Math.cos(theta),
          y: R_base * Math.cos(phi),
          z: R_base * Math.sin(phi) * Math.sin(theta),
        })
      }

      // Single ring of orphan nodes — Saturn's iconic ring
      // Tilted 26.7° (Saturn's actual axial tilt), flat disc in tilted XZ plane
      if (allOrphans.length > 0) {
        const TILT_RAD = 26.7 * Math.PI / 180  // Saturn's axial tilt
        const cosTilt = Math.cos(TILT_RAD)
        const sinTilt = Math.sin(TILT_RAD)
        const RING_INNER = R_base * 1.6
        const RING_OUTER = R_base * 2.2

        allOrphans.forEach((node, idx) => {
          // Slight angular clustering every ~8 nodes for visual density variation
          const clusterPhase = Math.floor(idx / 8) * 0.3
          const angle = (idx / allOrphans.length) * Math.PI * 2 + clusterPhase
          // Radial scatter for ring thickness (deterministic via golden ratio)
          const radialFrac = ((idx * 0.6180339887498949) % 1)
          const r = RING_INNER + radialFrac * (RING_OUTER - RING_INNER)

          // Position in flat ring plane, then tilt around X axis by 26.7°
          const flatX = r * Math.cos(angle)
          const flatZ = r * Math.sin(angle)
          const flatY = ((idx * 1.6180339887498949) % 1 - 0.5) * 4  // minimal Y scatter

          saturnTargets.set(node.id, {
            x: flatX,
            y: flatY * cosTilt + flatZ * sinTilt,
            z: -flatY * sinTilt + flatZ * cosTilt,
          })
        })
      }
    }

    // ── Milky Way target positions (flat 2D spiral — top-down galaxy view) ──
    const milkywayTargets = new Map<string, { x: number; y: number; z: number }>()

    {
      const armScale = 50 + connectedCount * 0.35
      const NUM_ARMS = 2           // 2 dominant arms like M51
      const SPIRAL_TURNS = 1.5     // fewer turns = more spread out arms

      // Sort all connected nodes: by cluster (largest first) then by id within cluster
      const allConnectedSorted: string[] = []
      for (const cluster of allClusters) {
        const sorted = [...cluster].sort((a, b) => a.localeCompare(b))
        allConnectedSorted.push(...sorted)
      }

      // Central bulge: only the dominant cluster if it's >30% of connected nodes
      const dominantCluster = allClusters.length > 0 && connectedCount > 0 &&
        allClusters[0].length > connectedCount * 0.30 ? allClusters[0] : null
      const dominantIds = new Set(dominantCluster ?? [])

      const bulgeRadius = armScale * 0.6
      if (dominantCluster && dominantCluster.length > 0) {
        const goldenAngle = Math.PI * (3 - Math.sqrt(5))

        for (let j = 0; j < dominantCluster.length; j++) {
          const nodeId = dominantCluster[j]
          // Fibonacci disc for even distribution in 2D — packed elliptical bulge
          const r = bulgeRadius * Math.sqrt((j + 0.5) / dominantCluster.length)
          const theta = j * goldenAngle
          // Elliptical: stretch X by 1.5 for bar shape
          const x = r * Math.cos(theta) * 1.5
          const z = r * Math.sin(theta)
          const y = ((j * 1.6180339887498949) % 1 - 0.5) * 6  // near-zero Y scatter

          milkywayTargets.set(nodeId, { x, y, z })
        }
      }

      // Spiral arms: Archimedean spiral with block distribution and wide dark gaps
      const spiralNodes = allConnectedSorted.filter(id => !dominantIds.has(id))
      const nodesPerArm = Math.ceil(spiralNodes.length / NUM_ARMS)

      // Archimedean spiral: r = r_start + t * (r_end - r_start) — LINEAR increase
      const r_start = bulgeRadius * 1.1  // arms start just outside bulge
      const r_end = r_start + armScale * 3  // how far arms extend

      for (let i = 0; i < spiralNodes.length; i++) {
        const nodeId = spiralNodes[i]
        // Block distribution: contiguous blocks of nodes per arm
        const armIdx = Math.min(Math.floor(i / nodesPerArm), NUM_ARMS - 1)
        const posInArm = i - armIdx * nodesPerArm
        const armOffset = (armIdx / NUM_ARMS) * 2 * Math.PI

        // Progress along this arm (0→1)
        const t = (posInArm + 0.5) / Math.max(nodesPerArm, 1)

        // Archimedean spiral: linear radius increase + angular sweep
        const r = r_start + t * (r_end - r_start)
        const theta = t * SPIRAL_TURNS * 2 * Math.PI + armOffset

        // Scatter perpendicular to arm direction — very tight streams
        const armWidth = r * 0.03 + 1
        const perpScatter = ((i * 1.6180339887498949) % 1 - 0.5) * armWidth

        const dx = -Math.sin(theta) * perpScatter
        const dz = Math.cos(theta) * perpScatter

        milkywayTargets.set(nodeId, {
          x: r * Math.cos(theta) + dx,
          y: ((i * 2.6180339887498949) % 1 - 0.5) * 4,
          z: r * Math.sin(theta) + dz,
        })
      }

      // Orphan nodes: extend spiral arms outward beyond connected nodes
      if (allOrphans.length > 0) {
        const orphansPerArm = Math.ceil(allOrphans.length / NUM_ARMS)

        allOrphans.forEach((node, idx) => {
          const armIdx = Math.min(Math.floor(idx / orphansPerArm), NUM_ARMS - 1)
          const posInArm = idx - armIdx * orphansPerArm
          const armOffset = (armIdx / NUM_ARMS) * 2 * Math.PI

          const extraT = (posInArm + 0.5) / Math.max(orphansPerArm, 1)
          // Continue Archimedean spiral beyond r_end
          const r = r_end + extraT * armScale * 1.5
          const theta = SPIRAL_TURNS * 2 * Math.PI + extraT * Math.PI + armOffset

          const perpScatter = ((idx * 0.6180339887498949) % 1 - 0.5) * r * 0.05
          const dx = -Math.sin(theta) * perpScatter
          const dz = Math.cos(theta) * perpScatter

          milkywayTargets.set(node.id, {
            x: r * Math.cos(theta) + dx,
            y: ((idx * 1.6180339887498949) % 1 - 0.5) * 6,
            z: r * Math.sin(theta) + dz,
          })
        })
      }
    }

    // ── Set initial positions based on active shape ─────────────────────────
    if (graphShape === 'saturn') {
      for (const node of simNodes) {
        const target = saturnTargets.get(node.id)
        if (!target) continue
        node.x = target.x * currentSpread + (Math.random() - 0.5) * 20
        node.y = target.y * currentSpread + (Math.random() - 0.5) * 20
        node.z = target.z * currentSpread + (Math.random() - 0.5) * 20
      }
    } else if (graphShape === 'milkyway') {
      for (const node of simNodes) {
        const target = milkywayTargets.get(node.id)
        if (!target) continue
        node.x = target.x * currentSpread + (Math.random() - 0.5) * 20
        node.y = target.y * currentSpread + (Math.random() - 0.5) * 20
        node.z = target.z * currentSpread + (Math.random() - 0.5) * 20
      }
    }

    // ── Shape force: pulls nodes toward their target positions ──────────────
    const shapeForce = (alpha: number) => {
      if (graphShape === 'centroid') {
        // Same-folder orphans attract each other (original centroid behavior)
        const k = alpha * 0.012
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
      } else if (graphShape === 'saturn') {
        // Pull all nodes toward Saturn sphere/ring targets (very strong snap to surface)
        const k = alpha * 0.8
        for (const node of simNodes) {
          const target = saturnTargets.get(node.id)
          if (!target) continue
          node.vx += (target.x * currentSpread - node.x) * k
          node.vy += (target.y * currentSpread - node.y) * k
          node.vz += (target.z * currentSpread - node.z) * k
        }
      } else if (graphShape === 'milkyway') {
        // Pull all nodes toward Milky Way spiral targets (extremely strong — shape formula dominates)
        const k = alpha * 0.8
        for (const node of simNodes) {
          const target = milkywayTargets.get(node.id)
          if (!target) continue
          node.vx += (target.x * currentSpread - node.x) * k
          node.vy += (target.y * currentSpread - node.y) * k
          node.vz += (target.z * currentSpread - node.z) * k
        }
      }
    }

    // Weaker charge for saturn/milkyway — shape formula dominates, forces add subtle jitter only
    const chargeStrength = graphShape === 'milkyway' ? 0 : graphShape === 'saturn' ? -3 : -120
    const centerStrength = graphShape === 'milkyway' ? 0 : graphShape === 'saturn' ? 0 : 0.05

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    simulation = forceSimulation(simNodes as any, 3)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .force('link', forceLink(simLinks as any).id((d: unknown) => (d as WorkerNode).id)
        .distance(graphShape === 'milkyway' ? 20 : 60)
        .strength(graphShape === 'milkyway' ? 0 : graphShape === 'saturn' ? 0.05 : 0.5))
      .force('charge', forceManyBody().strength(chargeStrength))
      .force('center', forceCenter(0, 0, 0).strength(centerStrength))
      .force('collide', (graphShape === 'milkyway' || graphShape === 'saturn') ? null : forceCollide(12))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .force('isolated', isolatedForce as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .force('shape', shapeForce as any)
      .alphaDecay(0.02)
      .velocityDecay(0.4)
      .stop()

    runTick()
  } else if (type === 'setSpread') {
    const spread = (e.data as { spread?: number }).spread ?? 1.0
    currentSpread = spread  // shape targets scale with spread
    if (simulation) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lf = simulation.force('link') as any
      if (lf?.distance) lf.distance(60 * spread)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cf = simulation.force('charge') as any
      const baseCharge = graphShape === 'milkyway' ? 0 : graphShape === 'saturn' ? -3 : -120
      if (cf?.strength) cf.strength(baseCharge * spread)
      tickCount = 0
      simulation.alpha(0.3)
      if (!tickRunning) runTick()
    }
  } else if (type === 'reheat') {
    if (simulation) {
      tickCount = 0
      simulation.alpha(0.3)
      if (!tickRunning) runTick()
    }
  } else if (type === 'setFilter') {
    const visibleIds = new Set((e.data as { visibleIds?: string[] }).visibleIds ?? [])
    if (simulation && visibleIds.size > 0) {
      let cx = 0, cy = 0, cz = 0, cnt = 0
      for (const node of simNodes) {
        if (visibleIds.has(node.id)) { cx += node.x; cy += node.y; cz += node.z; cnt++ }
      }
      if (cnt > 0) { cx /= cnt; cy /= cnt; cz /= cnt }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cf = simulation.force('center') as any
      if (cf?.x) { cf.x(cx); cf.y(cy); cf.z(cz) }
      tickCount = 0
      simulation.alpha(0.3)
      if (!tickRunning) runTick()
    }
  } else if (type === 'stop') {
    if (simulation) simulation.stop()
    tickRunning = false
  }
}
