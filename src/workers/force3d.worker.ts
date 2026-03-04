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
const MAX_TICKS = 300
let graphShape: 'ring' | 'centroid' | 'jupiter' | 'milkyway' = 'ring'
let currentSpread = 1.5

function getNodePositions(nodes: WorkerNode[]) {
  return nodes.map(n => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 }))
}

function runTick() {
  if (!simulation || tickCount >= MAX_TICKS) {
    tickRunning = false
    self.postMessage({ type: 'end', nodes: getNodePositions(simNodes) })
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
    })
  }

  setTimeout(runTick, 0)
}

self.onmessage = (e: MessageEvent) => {
  const { type, nodes, links } = e.data as {
    type: string
    nodes?: Array<{ id: string; folder: string }>
    links?: Array<{ source: string; target: string }>
    graphShape?: 'ring' | 'centroid' | 'jupiter' | 'milkyway'
  }

  if (type === 'setGraphShape') {
    graphShape = (e.data as { graphShape?: 'ring' | 'centroid' | 'jupiter' | 'milkyway' }).graphShape ?? 'ring'
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

    simNodes = (nodes ?? []).map((n) => ({
      id: n.id,
      folder: n.folder,
      x: (Math.random() - 0.5) * 400,
      y: (Math.random() - 0.5) * 400,
      z: (Math.random() - 0.5) * 400,
      vx: 0,
      vy: 0,
      vz: 0,
    }))

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

    // ── Ring-slot target positions ──────────────────────────────────────────
    const ringTargets = new Map<string, { x: number; y: number; z: number }>()

    if (allOrphans.length > 0) {
      const ORPHANS_PER_RING = 50
      const RING_BASE_RADIUS = 350  // base radius at spread=1; scales with currentSpread
      const RING_SPACING = 80
      const RING_TILT = 0.18 // slight tilt in radians for 3D effect

      allOrphans.forEach((node, idx) => {
        const ring = Math.floor(idx / ORPHANS_PER_RING)
        const posInRing = idx % ORPHANS_PER_RING
        const countInRing = Math.min(ORPHANS_PER_RING, allOrphans.length - ring * ORPHANS_PER_RING)
        const angle = (posInRing / countInRing) * Math.PI * 2
        const baseRadius = RING_BASE_RADIUS + ring * RING_SPACING

        const ux = Math.cos(angle)
        const uy = Math.sin(angle) * Math.sin(RING_TILT)
        const uz = Math.sin(angle) * Math.cos(RING_TILT)

        ringTargets.set(node.id, { x: ux * baseRadius, y: uy * baseRadius, z: uz * baseRadius })
      })
    }

    // ── Jupiter target positions ────────────────────────────────────────────
    const jupiterTargets = new Map<string, { x: number; y: number; z: number }>()

    {
      const R_base = 150 + Math.sqrt(connectedCount) * 3
      const goldenAngle = Math.PI * (3 - Math.sqrt(5))  // ~2.399 rad
      const N = Math.max(allClusters.length, 1)

      // Planet body: connected nodes on sphere surface organized by latitude bands
      for (let ci = 0; ci < allClusters.length; ci++) {
        const cluster = allClusters[ci]
        const phi0 = (ci / N) * Math.PI
        const phi1 = ((ci + 1) / N) * Math.PI
        const cosPhi0 = Math.cos(phi0)
        const cosPhi1 = Math.cos(phi1)

        for (let j = 0; j < cluster.length; j++) {
          const nodeId = cluster[j]
          // Linear interp in cos(phi) space = uniform surface area within band
          const cosPhiNode = cosPhi0 + ((j + 0.5) / cluster.length) * (cosPhi1 - cosPhi0)
          const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhiNode * cosPhiNode))
          const theta = j * goldenAngle

          jupiterTargets.set(nodeId, {
            x: R_base * sinPhi * Math.cos(theta),
            y: R_base * cosPhiNode,
            z: R_base * sinPhi * Math.sin(theta),
          })
        }
      }

      // Orphan rings: 3 rings in XZ plane, tilted 3.1° (Jupiter's axial tilt)
      if (allOrphans.length > 0) {
        const RING_TILT = Math.sin(3.1 * Math.PI / 180)  // ~0.054
        const RING_RADII = [R_base * 1.4, R_base * 1.65, R_base * 1.9]
        const RING_Y_WIDTHS = [8, 5, 4]
        const nodesPerRing = Math.ceil(allOrphans.length / 3)

        allOrphans.forEach((node, idx) => {
          const ringIdx = Math.min(Math.floor(idx / nodesPerRing), 2)
          const posInRing = idx - ringIdx * nodesPerRing
          const countInRing = Math.min(nodesPerRing, allOrphans.length - ringIdx * nodesPerRing)
          const angle = (posInRing / Math.max(countInRing, 1)) * Math.PI * 2
          const ringRadius = RING_RADII[ringIdx]
          const yOffset = RING_Y_WIDTHS[ringIdx] * ((idx % 7) / 6 - 0.5)

          jupiterTargets.set(node.id, {
            x: ringRadius * Math.cos(angle),
            y: ringRadius * RING_TILT * Math.sin(angle) + yOffset,
            z: ringRadius * Math.sin(angle),
          })
        })
      }
    }

    // ── Milky Way target positions ──────────────────────────────────────────
    const milkywayTargets = new Map<string, { x: number; y: number; z: number }>()

    {
      const armScale = 20 + connectedCount * 0.15
      const maxTheta = 4 * Math.PI

      // Sort all connected nodes: by cluster (largest first) then by id within cluster
      const allConnectedSorted: string[] = []
      for (const cluster of allClusters) {
        const sorted = [...cluster].sort((a, b) => a.localeCompare(b))
        allConnectedSorted.push(...sorted)
      }

      // Dominant cluster (>20% of nodes) → central bar along X axis
      const dominantCluster = allClusters.length > 0 && connectedCount > 0 &&
        allClusters[0].length > connectedCount * 0.2 ? allClusters[0] : null
      const dominantIds = new Set(dominantCluster ?? [])

      if (dominantCluster && dominantCluster.length > 0) {
        const barLength = armScale * 2.5
        for (let j = 0; j < dominantCluster.length; j++) {
          const nodeId = dominantCluster[j]
          const t = dominantCluster.length > 1 ? j / (dominantCluster.length - 1) : 0.5
          const x = (t - 0.5) * barLength
          // Pseudo-random y/z scatter using golden ratio multiples
          const yOff = ((j * 1.6180339887498949) % 1 - 0.5) * 20
          const zOff = ((j * 2.6180339887498949) % 1 - 0.5) * 15
          milkywayTargets.set(nodeId, { x, y: yOff, z: zOff })
        }
      }

      // Spiral arms: non-dominant connected nodes (2 arms, 180° apart)
      const spiralNodes = allConnectedSorted.filter(id => !dominantIds.has(id))
      const totalSpiral = spiralNodes.length

      for (let i = 0; i < spiralNodes.length; i++) {
        const nodeId = spiralNodes[i]
        const t = (i / Math.max(totalSpiral - 1, 1)) * maxTheta
        const arm = i % 2  // alternate arms
        const r = armScale * Math.exp(0.2 * t)
        const angle = t + arm * Math.PI
        const yOff = ((i * 1.6180339887498949) % 1 - 0.5) * 16  // slight galactic thickness

        milkywayTargets.set(nodeId, {
          x: r * Math.cos(angle),
          y: yOff,
          z: r * Math.sin(angle),
        })
      }

      // Orphan halo: spherical shell via Fibonacci sphere (deterministic)
      if (allOrphans.length > 0) {
        const maxR = armScale * Math.exp(0.2 * maxTheta)
        const haloMin = maxR * 1.3
        const haloRange = maxR * 0.5  // 1.3 to 1.8 × maxR

        allOrphans.forEach((node, idx) => {
          const i = idx + 0.5
          const phi = Math.acos(1 - 2 * i / allOrphans.length)
          const theta = Math.PI * (1 + Math.sqrt(5)) * i
          const halorR = haloMin + ((idx * 0.6180339887498949) % 1) * haloRange

          milkywayTargets.set(node.id, {
            x: halorR * Math.sin(phi) * Math.cos(theta),
            y: halorR * Math.cos(phi),
            z: halorR * Math.sin(phi) * Math.sin(theta),
          })
        })
      }
    }

    // ── Set initial positions based on active shape ─────────────────────────
    if (graphShape === 'ring' && allOrphans.length > 0) {
      // Place orphans near their ring slots
      allOrphans.forEach((node) => {
        const target = ringTargets.get(node.id)
        if (!target) return
        node.x = target.x * currentSpread + (Math.random() - 0.5) * 20
        node.y = target.y * currentSpread + (Math.random() - 0.5) * 20
        node.z = target.z * currentSpread + (Math.random() - 0.5) * 20
      })
    } else if (graphShape === 'jupiter') {
      for (const node of simNodes) {
        const target = jupiterTargets.get(node.id)
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
      if (graphShape === 'ring') {
        // Pull each orphan toward its ring slot, scaled by currentSpread
        const k = alpha * 0.06
        for (const node of allOrphans) {
          const target = ringTargets.get(node.id)
          if (!target) continue
          node.vx += (target.x * currentSpread - node.x) * k
          node.vy += (target.y * currentSpread - node.y) * k
          node.vz += (target.z * currentSpread - node.z) * k
        }
      } else if (graphShape === 'centroid') {
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
      } else if (graphShape === 'jupiter') {
        // Pull all nodes toward Jupiter sphere/ring targets
        const k = alpha * 0.08
        for (const node of simNodes) {
          const target = jupiterTargets.get(node.id)
          if (!target) continue
          node.vx += (target.x * currentSpread - node.x) * k
          node.vy += (target.y * currentSpread - node.y) * k
          node.vz += (target.z * currentSpread - node.z) * k
        }
      } else if (graphShape === 'milkyway') {
        // Pull all nodes toward Milky Way spiral/bar/halo targets
        const k = alpha * 0.08
        for (const node of simNodes) {
          const target = milkywayTargets.get(node.id)
          if (!target) continue
          node.vx += (target.x * currentSpread - node.x) * k
          node.vy += (target.y * currentSpread - node.y) * k
          node.vz += (target.z * currentSpread - node.z) * k
        }
      }
    }

    // Weaker charge for jupiter/milkyway — shape force handles clustering, not repulsion
    const chargeStrength = (graphShape === 'jupiter' || graphShape === 'milkyway') ? -60 : -120

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    simulation = forceSimulation(simNodes as any, 3)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .force('link', forceLink(simLinks as any).id((d: unknown) => (d as WorkerNode).id).distance(60).strength(0.5))
      .force('charge', forceManyBody().strength(chargeStrength))
      .force('center', forceCenter(0, 0, 0).strength(0.05))
      .force('collide', forceCollide(12))
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
      const baseCharge = (graphShape === 'jupiter' || graphShape === 'milkyway') ? -60 : -120
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
