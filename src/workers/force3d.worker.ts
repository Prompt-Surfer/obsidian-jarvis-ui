import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from 'd3-force-3d'

interface WorkerNode {
  id: string
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
    nodes?: Array<{ id: string }>
    links?: Array<{ source: string; target: string }>
  }

  if (type === 'init') {
    tickRunning = false
    tickCount = 0

    simNodes = (nodes ?? []).map((n) => ({
      id: n.id,
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    simulation = forceSimulation(simNodes as any, 3)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .force('link', forceLink(simLinks as any).id((d: unknown) => (d as WorkerNode).id).distance(60).strength(0.5))
      .force('charge', forceManyBody().strength(-120))
      .force('center', forceCenter(0, 0, 0).strength(0.05))
      .force('collide', forceCollide(12))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .force('isolated', isolatedForce as any)
      .alphaDecay(0.02)
      .velocityDecay(0.4)
      .stop()

    runTick()
  } else if (type === 'setSpread') {
    const spread = (e.data as { spread?: number }).spread ?? 1.0
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
  } else if (type === 'stop') {
    if (simulation) simulation.stop()
    tickRunning = false
  }
}
