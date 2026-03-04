export interface GraphLink {
  source: string
  target: string
}

/**
 * BFS shortest path between two nodes.
 * Returns array of node IDs forming the path, or null if disconnected.
 */
export function bfsPath(
  startId: string,
  endId: string,
  links: GraphLink[]
): string[] | null {
  if (startId === endId) return [startId]

  // Build adjacency list
  const adj = new Map<string, Set<string>>()
  for (const link of links) {
    const s = typeof link.source === 'string' ? link.source : (link.source as unknown as { id: string }).id
    const t = typeof link.target === 'string' ? link.target : (link.target as unknown as { id: string }).id
    if (!adj.has(s)) adj.set(s, new Set())
    if (!adj.has(t)) adj.set(t, new Set())
    adj.get(s)!.add(t)
    adj.get(t)!.add(s)
  }

  // BFS
  const visited = new Set<string>([startId])
  const queue: string[] = [startId]
  const parent = new Map<string, string>()

  while (queue.length > 0) {
    const current = queue.shift()!
    const neighbors = adj.get(current) || new Set()
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        parent.set(neighbor, current)
        if (neighbor === endId) {
          // Reconstruct path
          const path: string[] = []
          let node: string | undefined = endId
          while (node !== undefined) {
            path.unshift(node)
            node = parent.get(node)
          }
          return path
        }
        queue.push(neighbor)
      }
    }
  }

  return null // No path found
}
