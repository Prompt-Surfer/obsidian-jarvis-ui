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

    // ── Milky Way target positions (density-gradient disc with spiral arms) ──
    // Approach: distribute ALL nodes across the full galactic disc. Nodes near
    // spiral arm curves get pulled closer to them (higher density), nodes between
    // arms spread naturally (lower density). The arms appear as density waves,
    // not exclusive thin tracks. Like real galaxies — stars everywhere, denser in arms.
    const milkywayTargets = new Map<string, { x: number; y: number; z: number }>()

    {
      const totalNodes = connectedCount + allOrphans.length
      const galaxyRadius = 120 + Math.sqrt(totalNodes) * 8  // overall disc radius
      const NUM_ARMS = 2
      const SPIRAL_TIGHTNESS = 0.5   // controls how tightly wound the arms are
      const ARM_ATTRACTION = 0.85   // 0=uniform disc, 1=nodes only on arms — high for bold arms

      // Collect all node IDs in one array: connected first, then orphans
      const allNodeIds: string[] = []
      for (const cluster of allClusters) {
        for (const id of cluster) allNodeIds.push(id)
      }
      for (const orphan of allOrphans) allNodeIds.push(orphan.id)

      // Golden angle for Fibonacci disc base distribution
      const goldenAngle = Math.PI * (3 - Math.sqrt(5))

      // Central bulge: first 15% of nodes get packed in the center
      const bulgeCount = Math.floor(totalNodes * 0.20)  // 20% of nodes in central bulge
      const bulgeRadius = galaxyRadius * 0.20  // bulge fills 20% of galaxy radius

      for (let i = 0; i < allNodeIds.length; i++) {
        const nodeId = allNodeIds[i]
        let x: number, z: number, y: number

        if (i < bulgeCount) {
          // Central bulge: tight Fibonacci disc
          const r = bulgeRadius * Math.sqrt((i + 0.5) / bulgeCount)
          const theta = i * goldenAngle
          x = r * Math.cos(theta) * 1.3  // slight ellipticity for bar
          z = r * Math.sin(theta)
          y = ((i * 1.6180339887498949) % 1 - 0.5) * 3  // tiny Y spread
        } else {
          // Disc nodes: Fibonacci disc distribution, then attracted toward nearest arm
          const discIdx = i - bulgeCount
          const discTotal = totalNodes - bulgeCount

          // Base position: Fibonacci disc (even spread across full disc)
          const baseR = bulgeRadius + (galaxyRadius - bulgeRadius) * Math.sqrt((discIdx + 0.5) / discTotal)
          const baseTheta = discIdx * goldenAngle

          // Find the nearest spiral arm point and pull toward it
          // Spiral arm equation: theta_arm = ln(r / a) / b + offset
          // For Archimedean: theta_arm = (r - bulgeRadius) * TIGHTNESS / galaxyRadius + offset
          // Find nearest major spiral arm (2 arms only — clean, bold)
          let minAngDist = Infinity

          for (let arm = 0; arm < NUM_ARMS; arm++) {
            const armOffset = (arm / NUM_ARMS) * 2 * Math.PI
            // Spiral arm angle at this radius
            const armTheta = ((baseR - bulgeRadius) / galaxyRadius) * SPIRAL_TIGHTNESS * 2 * Math.PI * 3 + armOffset
            // Angular distance (wrapped to -PI..PI)
            let angDist = baseTheta - armTheta
            angDist = angDist - Math.round(angDist / (2 * Math.PI)) * 2 * Math.PI
            if (Math.abs(angDist) < Math.abs(minAngDist)) {
              minAngDist = angDist
            }
          }

          // Pull all nodes toward nearest arm — stronger pull = more visible arms
          const attractedTheta = baseTheta - minAngDist * ARM_ATTRACTION
          const r = baseR

          // Add slight radial scatter for naturalness
          // More organic scatter — radial + angular jitter
          const radialScatter = ((discIdx * 2.236) % 1 - 0.5) * galaxyRadius * 0.06
          const angularJitter = ((discIdx * 3.1415) % 1 - 0.5) * 0.04

          x = (r + radialScatter) * Math.cos(attractedTheta + angularJitter)
          z = (r + radialScatter) * Math.sin(attractedTheta + angularJitter)
          y = ((discIdx * 1.6180339887498949) % 1 - 0.5) * 2  // very flat
        }

        milkywayTargets.set(nodeId, { x, y, z })
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
    const chargeStrength = (graphShape === 'milkyway' || graphShape === 'saturn') ? 0 : -120
    const centerStrength = (graphShape === 'milkyway' || graphShape === 'saturn') ? 0 : 0.05

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    simulation = forceSimulation(simNodes as any, 3)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .force('link', forceLink(simLinks as any).id((d: unknown) => (d as WorkerNode).id)
        .distance(graphShape === 'milkyway' ? 20 : 60)
        .strength((graphShape === 'milkyway' || graphShape === 'saturn') ? 0 : 0.5))
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
      const baseCharge = (graphShape === 'milkyway' || graphShape === 'saturn') ? 0 : -120
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
