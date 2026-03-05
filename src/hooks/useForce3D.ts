import { useState, useEffect, useRef, useCallback } from 'react'
import type { GraphNode, GraphLink, GraphData } from './useVaultGraph'

export interface NodePosition {
  id: string
  x: number
  y: number
  z: number
}

// Enable pipeline profiling via ?perf query param in dev
const DEBUG = import.meta.env.DEV && typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('perf')

export function useForce3D(graphData: GraphData | null, graphShape: 'centroid' | 'saturn' | 'milkyway' | 'brain' = 'centroid') {
  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map())
  const [simDone, setSimDone] = useState(false)
  const workerRef = useRef<Worker | null>(null)

  // Track current spread so worker init can use it (not stale default)
  const spreadRef = useRef(2.0)

  // Latest positions ref — used to pass warm-restart positions to the next worker init
  const latestPositionsRef = useRef<Map<string, NodePosition>>(new Map())
  // RAF buffer — accumulate positions updates, apply at frame boundary (one setState per frame)
  const pendingNodesRef = useRef<Array<{ id: string; x: number; y: number; z: number }> | null>(null)
  const rafHandleRef = useRef<number | null>(null)
  // Track previous graphData ref to detect shape-only vs data changes
  const prevGraphDataRef = useRef<GraphData | null>(null)

  useEffect(() => {
    if (!graphData) return

    // Detect shape-only change: same graphData ref, different graphShape
    const isShapeOnlyChange = prevGraphDataRef.current === graphData && workerRef.current !== null
    prevGraphDataRef.current = graphData

    // Terminate previous worker; cancel any pending RAF flush
    workerRef.current?.terminate()
    if (rafHandleRef.current !== null) {
      cancelAnimationFrame(rafHandleRef.current)
      rafHandleRef.current = null
    }
    pendingNodesRef.current = null
    setSimDone(false)

    if (DEBUG) {
      performance.mark('t1-worker-init-start')
      console.debug(`[perf] worker init start — shape=${graphShape} shapeOnlyChange=${isShapeOnlyChange}`)
    }

    const worker = new Worker(
      new URL('../workers/force3d.worker.ts', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent) => {
      const { type, nodes, firstTick } = e.data

      if (type === 'tick' || type === 'end') {
        if (DEBUG && firstTick) {
          performance.mark('t2-first-tick-received')
          performance.measure('t1→t2 init-to-first-tick', 't1-worker-init-start', 't2-first-tick-received')
          console.debug('[perf] first tick received:', performance.getEntriesByName('t1→t2 init-to-first-tick').at(-1)?.duration?.toFixed(1), 'ms')
        }
        if (DEBUG && type === 'end') {
          performance.mark('t3-sim-done')
          performance.measure('t2→t3 first-tick-to-done', 't2-first-tick-received', 't3-sim-done')
          console.debug(`[perf] sim done at tick=${e.data.tickCount} alpha=${e.data.alpha?.toFixed(5)}`,
            performance.getEntriesByName('t2→t3 first-tick-to-done').at(-1)?.duration?.toFixed(1), 'ms')
        }

        // RAF buffer: store latest positions, apply at frame boundary (at most one setState per rAF)
        pendingNodesRef.current = nodes
        if (rafHandleRef.current === null) {
          rafHandleRef.current = requestAnimationFrame(() => {
            rafHandleRef.current = null
            const pending = pendingNodesRef.current
            if (!pending) return
            const posMap = new Map<string, NodePosition>()
            for (const n of pending) posMap.set(n.id, n)
            latestPositionsRef.current = posMap
            setPositions(posMap)
            pendingNodesRef.current = null
          })
        }

        // simDone fires immediately — don't delay behind RAF (clears patternLoading promptly)
        if (type === 'end') {
          setSimDone(true)
        }
      }
    }

    // Warm restart: pass existing positions for shape-only changes so nodes start near
    // their current locations rather than random scatter → visual convergence much faster
    const existingPositions = isShapeOnlyChange
      ? Array.from(latestPositionsRef.current.values())
      : undefined

    if (DEBUG) performance.mark('t1-worker-init-send')

    worker.postMessage({
      type: 'init',
      nodes: graphData.nodes.map((n: GraphNode) => ({ id: n.id, folder: n.folder ?? '' })),
      links: graphData.links.map((l: GraphLink) => ({
        source: typeof l.source === 'string' ? l.source : (l.source as GraphNode).id,
        target: typeof l.target === 'string' ? l.target : (l.target as GraphNode).id,
      })),
      graphShape,
      existingPositions,
      spread: spreadRef.current,
    })

    return () => {
      worker.terminate()
      pendingNodesRef.current = null
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current)
        rafHandleRef.current = null
      }
    }
  }, [graphData, graphShape])

  const reheat = useCallback(() => {
    workerRef.current?.postMessage({ type: 'reheat' })
    setSimDone(false)
  }, [])

  const setSpread = useCallback((value: number) => {
    spreadRef.current = value
    workerRef.current?.postMessage({ type: 'setSpread', spread: value })
    setSimDone(false)
  }, [])

  const setFilter = useCallback((visibleIds: string[]) => {
    workerRef.current?.postMessage({ type: 'setFilter', visibleIds })
  }, [])

  const pinNodes = useCallback((pinned: Array<{ id: string; x: number; y: number; z: number }>) => {
    workerRef.current?.postMessage({ type: 'pinNodes', pinned })
  }, [])

  const moveNodes = useCallback((pinned: Array<{ id: string; x: number; y: number; z: number }>) => {
    workerRef.current?.postMessage({ type: 'moveNodes', pinned })
  }, [])

  const unpinNodes = useCallback((ids: string[]) => {
    workerRef.current?.postMessage({ type: 'unpinNodes', ids })
  }, [])

  const resetPins = useCallback(() => {
    workerRef.current?.postMessage({ type: 'resetPins' })
  }, [])

  return { positions, simDone, reheat, setSpread, setFilter, pinNodes, moveNodes, unpinNodes, resetPins }
}
