import { useState, useEffect, useRef, useCallback } from 'react'
import type { GraphNode, GraphLink, GraphData } from './useVaultGraph'

export interface NodePosition {
  id: string
  x: number
  y: number
  z: number
}

export function useForce3D(graphData: GraphData | null, orphanPattern: 'ring' | 'centroid' = 'ring') {
  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map())
  const [simDone, setSimDone] = useState(false)
  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    if (!graphData) return

    // Terminate previous worker and reset done flag
    workerRef.current?.terminate()
    setSimDone(false)

    const worker = new Worker(
      new URL('../workers/force3d.worker.ts', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent) => {
      const { type, nodes } = e.data

      if (type === 'tick' || type === 'end') {
        const posMap = new Map<string, NodePosition>()
        for (const n of nodes) {
          posMap.set(n.id, n)
        }
        setPositions(posMap)

        if (type === 'end') {
          setSimDone(true)
        }
      }
    }

    worker.postMessage({
      type: 'init',
      nodes: graphData.nodes.map((n: GraphNode) => ({ id: n.id, folder: n.folder ?? '' })),
      links: graphData.links.map((l: GraphLink) => ({
        source: typeof l.source === 'string' ? l.source : (l.source as GraphNode).id,
        target: typeof l.target === 'string' ? l.target : (l.target as GraphNode).id,
      })),
      orphanPattern,
    })

    return () => {
      worker.terminate()
    }
  }, [graphData, orphanPattern])

  const reheat = useCallback(() => {
    workerRef.current?.postMessage({ type: 'reheat' })
    setSimDone(false)
  }, [])

  const setSpread = useCallback((value: number) => {
    workerRef.current?.postMessage({ type: 'setSpread', spread: value })
    setSimDone(false)
  }, [])

  const setFilter = useCallback((visibleIds: string[]) => {
    workerRef.current?.postMessage({ type: 'setFilter', visibleIds })
  }, [])

  return { positions, simDone, reheat, setSpread, setFilter }
}
