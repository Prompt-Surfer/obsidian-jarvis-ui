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
let orphanPattern: 'ring' | 'centroid' = 'ring'
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
    orphanPattern?: 'ring' | 'centroid'
  }

  if (type === 'setOrphanPattern') {
    orphanPattern = (e.data as { orphanPattern?: 'ring' | 'centroid' }).orphanPattern ?? 'ring'
    // Reheat sim so orphans animate to new positions
    if (simulation) {
      tickCount = 0
      simulation.alpha(0.6)
      if (!tickRunning) runTick()
    }
    return
  }

  // Pin nodes at specific positions (drag start / drag move)
  if (type === 'pinNodes' || type === 'moveNodes') {
    const pinned = (e.data as { pinned?: Array<{ id: string; x: number; y: number; z: number }> }).pinned ?? []
    for (const p of pinned) {
      const node = simNodes.find(n => n.id === p.id)
      if (node) { node.fx = p.x; node.fy = p.y; node.fz = p.z; node.x = p.x; node.y = p.y; node.z = p.z }
    }
    // Resume sim so connected nodes respond to the moved anchor
    if (simulation && !tickRunning) {
      tickCount = 0
      simulation.alpha(0.3)
      runTick()
    }
    // Immediately emit positions for smooth visuals
    self.postMessage({ type: 'tick', nodes: getNodePositions(simNodes), tickCount, alpha: simulation?.alpha() ?? 0 })
    return
  }

  // Release pinned nodes after drag end
  if (type === 'unpinNodes') {
    const ids = (e.data as { ids?: string[] }).ids ?? []
    for (const id of ids) {
      const node = simNodes.find(n => n.id === id)
      if (node) { delete node.fx; delete node.fy; delete node.fz; node.vx = 0; node.vy = 0; node.vz = 0 }
    }
    if (simulation) {
      simulation.alpha(0.15)
      if (!tickRunning) { tickCount = 0; runTick() }
    }
    return
  }

  if (type === 'init') {
    tickRunning = false
    tickCount = 0
    if (e.data.orphanPattern) orphanPattern = e.data.orphanPattern

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

    // Ring-slot target positions (computed once, used as attractors during sim)
    const ringTargets = new Map<string, { x: number; y: number; z: number }>()

    if (orphanPattern === 'ring' && allOrphans.length > 0) {
      const ORPHANS_PER_RING = 50
      const RING_BASE_RADIUS = 350  // base radius at spread=1; scales with currentSpread
      const RING_SPACING = 80
      const RING_TILT = 0.18 // slight tilt in radians for 3D effect

      allOrphans.forEach((node, idx) => {
        const ring = Math.floor(idx / ORPHANS_PER_RING)
        const posInRing = idx % ORPHANS_PER_RING
        const countInRing = Math.min(ORPHANS_PER_RING, allOrphans.length - ring * ORPHANS_PER_RING)
        const angle = (posInRing / countInRing) * Math.PI * 2
        // Store base radius (spread=1); multiply by currentSpread when applying force
        const baseRadius = RING_BASE_RADIUS + ring * RING_SPACING

        // Unit-direction stored; actual position = dir * baseRadius * currentSpread
        const ux = Math.cos(angle)
        const uy = Math.sin(angle) * Math.sin(RING_TILT)
        const uz = Math.sin(angle) * Math.cos(RING_TILT)

        ringTargets.set(node.id, { x: ux * baseRadius, y: uy * baseRadius, z: uz * baseRadius })
        // Initialise near ring slot scaled to current spread
        node.x = ux * baseRadius * currentSpread + (Math.random() - 0.5) * 20
        node.y = uy * baseRadius * currentSpread + (Math.random() - 0.5) * 20
        node.z = uz * baseRadius * currentSpread + (Math.random() - 0.5) * 20
      })
    }

    // Orphan force: ring attractor (if ring mode) or centroid affinity (if centroid mode)
    const orphanForce = (alpha: number) => {
      if (orphanPattern === 'ring') {
        // Pull each orphan toward its ring slot, scaled by currentSpread
        const k = alpha * 0.06
        for (const node of allOrphans) {
          const target = ringTargets.get(node.id)
          if (!target) continue
          node.vx += (target.x * currentSpread - node.x) * k
          node.vy += (target.y * currentSpread - node.y) * k
          node.vz += (target.z * currentSpread - node.z) * k
        }
      } else {
        // centroid mode: same-folder orphans attract each other (original behavior)
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
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    simulation = forceSimulation(simNodes as any, 3)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .force('link', forceLink(simLinks as any).id((d: unknown) => (d as WorkerNode).id).distance(60).strength(0.5))
      .force('charge', forceManyBody().strength(-120))
      .force('center', forceCenter(0, 0, 0).strength(0.05))
      .force('collide', forceCollide(12))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .force('isolated', isolatedForce as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .force('orphan', orphanForce as any)
      .alphaDecay(0.02)
      .velocityDecay(0.4)
      .stop()

    runTick()
  } else if (type === 'setSpread') {
    const spread = (e.data as { spread?: number }).spread ?? 1.0
    currentSpread = spread  // ring targets scale with spread
    if (simulation) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lf = simulation.force('link') as any
      if (lf?.distance) lf.distance(60 * spread)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cf = simulation.force('charge') as any
      if (cf?.strength) cf.strength(-120 * spread)
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
