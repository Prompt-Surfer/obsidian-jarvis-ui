// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import { useState, useEffect, useRef, useCallback } from 'react'
import type { GraphNode, GraphLink, GraphData } from './useVaultGraph'

export interface NodePosition {
  id: string
  x: number
  y: number
  z: number
  tier?: 'regular' | 'supernode' | 'ultranode'
}

// Enable pipeline profiling via ?perf query param in dev
const DEBUG = import.meta.env.DEV && typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('perf')

export interface TagBox {
  tag: string; cx: number; cy: number; cz: number; count: number; halfSize?: number
  halfSizeX?: number; halfSizeY?: number; halfSizeZ?: number
  isVirtual?: boolean; parentTags?: [string, string]
}

// Perf metrics exposed to Graph3D's performance HUD
export interface PerfMetrics {
  simFps: number        // simulation tick batches received per second
  workerLatencyMs: number // rolling avg worker→main thread latency
  avgMovement: number   // average node movement per tick (convergence indicator)
}

// P1/P2: live position channel — the worker streams positions as transferable
// Float32Array(3N) buffers aligned to `ids` order (announced once per init via the
// 'nodeOrder' message). Graph3D's RAF loop consumes this ref directly by comparing
// `version`, so position updates never go through React state on the hot path.
export interface LiveSimPositions {
  /** node ids in sim order — same order as graphData.nodes passed to init */
  ids: string[]
  tiers: Array<'regular' | 'supernode' | 'ultranode'>
  /** xyz triplets; replaced (not mutated) on every tick batch */
  arr: Float32Array | null
  /** bumped on every tick batch — consumers compare against their last-seen value */
  version: number
}

// React-state mirror of positions (minimap, flyTo, camera fit) updates at most this
// often while the sim streams; the final 'end' message always flushes immediately
const STATE_MIRROR_MS = 250

export function useForce3D(graphData: GraphData | null, graphShape: 'sun' | 'saturn' | 'milkyway' | 'brain' | 'natural' | 'tagboxes' = 'natural', topNTags?: number, tagBoxSizeScale?: number) {
  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map())
  const [simDone, setSimDone] = useState(false)
  const [tagBoxes, setTagBoxes] = useState<TagBox[]>([])
  const workerRef = useRef<Worker | null>(null)

  // Track current spread so worker init can use it (not stale default)
  const spreadRef = useRef(2.0)

  // Live binary position channel consumed by Graph3D's RAF loop (P1/P2)
  const livePositionsRef = useRef<LiveSimPositions>({ ids: [], tiers: [], arr: null, version: 0 })
  const lastStateUpdateRef = useRef(0)
  // Track previous graphData ref to detect shape-only vs data changes
  const prevGraphDataRef = useRef<GraphData | null>(null)

  // Perf tracking: sim FPS, worker latency, node movement
  const perfRef = useRef<PerfMetrics>({ simFps: 0, workerLatencyMs: 0, avgMovement: 0 })
  const simTickTimestampsRef = useRef<number[]>([])
  const workerLatencySamplesRef = useRef<number[]>([])
  const prevArrRef = useRef<Float32Array | null>(null)

  useEffect(() => {
    if (!graphData?.nodes || !graphData?.links) return

    // Detect shape-only change: same graphData ref, different graphShape
    const isShapeOnlyChange = prevGraphDataRef.current === graphData && workerRef.current !== null
    prevGraphDataRef.current = graphData

    // Terminate previous worker
    workerRef.current?.terminate()
    lastStateUpdateRef.current = 0 // first message of the new worker mirrors to state immediately
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
      const { type, positions: posArr, firstTick, tagBoxes: boxes, timestamp } = e.data

      if (type === 'nodeOrder') {
        // P1: node order + tiers announced once per init — all subsequent position
        // updates are bare Float32Array(3N) transfers aligned to this order
        const live = livePositionsRef.current
        live.ids = e.data.ids ?? []
        live.tiers = e.data.tiers ?? []
        return
      }

      if (type === 'tagBoxes') {
        setTagBoxes(e.data.tagBoxes ?? [])
        return
      }

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

        // --- Perf: sim FPS tracking ---
        const now = performance.now()
        const simTs = simTickTimestampsRef.current
        simTs.push(now)
        // Keep only last 1 second of timestamps
        while (simTs.length > 0 && now - simTs[0] > 1000) simTs.shift()
        perfRef.current.simFps = simTs.length

        // --- Perf: worker→main latency (Note: performance.now() bases differ between
        // worker and main thread in some browsers, so this is an approximation) ---
        if (typeof timestamp === 'number') {
          const latency = now - timestamp
          const samples = workerLatencySamplesRef.current
          samples.push(latency)
          if (samples.length > 30) samples.shift()
          perfRef.current.workerLatencyMs = samples.reduce((a, b) => a + b, 0) / samples.length
        }

        const live = livePositionsRef.current
        const arr: Float32Array | null = posArr instanceof Float32Array ? posArr : null
        if (arr && arr.length === live.ids.length * 3) {
          // --- Perf: movement tracking (convergence indicator) — pure math, no allocs ---
          const prev = prevArrRef.current
          if (prev && prev.length === arr.length && arr.length > 0) {
            let totalMovement = 0
            for (let i = 0; i < arr.length; i += 3) {
              const dx = arr[i] - prev[i], dy = arr[i + 1] - prev[i + 1], dz = arr[i + 2] - prev[i + 2]
              totalMovement += Math.sqrt(dx * dx + dy * dy + dz * dz)
            }
            perfRef.current.avgMovement = totalMovement / (arr.length / 3)
          }
          prevArrRef.current = arr

          // P2: publish to the live channel — Graph3D's RAF loop picks this up next
          // frame via the version counter; no setState, no Map rebuild, no clone
          live.arr = arr
          live.version++

          // Throttled React mirror for non-hot-path consumers (minimap, flyTo, camera
          // fit). 'end' always flushes so final positions are exact.
          if (type === 'end' || lastStateUpdateRef.current === 0 || now - lastStateUpdateRef.current >= STATE_MIRROR_MS) {
            lastStateUpdateRef.current = now
            const posMap = new Map<string, NodePosition>()
            for (let i = 0; i < live.ids.length; i++) {
              posMap.set(live.ids[i], {
                id: live.ids[i],
                x: arr[i * 3],
                y: arr[i * 3 + 1],
                z: arr[i * 3 + 2],
                tier: live.tiers[i] ?? 'regular',
              })
            }
            setPositions(posMap)
          }
        }

        // Forward tag boxes when provided
        if (boxes) setTagBoxes(boxes)

        // simDone fires immediately (clears patternLoading promptly)
        if (type === 'end') {
          setSimDone(true)
        }
      }
    }

    // Warm restart: pass existing positions for shape-only changes so nodes start near
    // their current locations rather than random scatter → visual convergence much faster
    const live0 = livePositionsRef.current
    const existingPositions = isShapeOnlyChange && live0.arr && live0.arr.length === live0.ids.length * 3
      ? live0.ids.map((id, i) => ({ id, x: live0.arr![i * 3], y: live0.arr![i * 3 + 1], z: live0.arr![i * 3 + 2] }))
      : undefined

    if (DEBUG) performance.mark('t1-worker-init-send')

    worker.postMessage({
      type: 'init',
      nodes: graphData.nodes.map((n: GraphNode) => ({ id: n.id, folder: n.folder ?? '', tags: n.tags ?? [] })),
      links: graphData.links.map((l: GraphLink) => ({
        source: typeof l.source === 'string' ? l.source : (l.source as GraphNode).id,
        target: typeof l.target === 'string' ? l.target : (l.target as GraphNode).id,
      })),
      graphShape,
      existingPositions,
      spread: spreadRef.current,
      topN: topNTags ?? 24,
      tagBoxSizeScale: tagBoxSizeScale ?? 1.0,
    })

    return () => {
      worker.terminate()
    }
  }, [graphData, graphShape, topNTags, tagBoxSizeScale])

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

  return { positions, livePositions: livePositionsRef, simDone, tagBoxes, reheat, setSpread, setFilter, pinNodes, moveNodes, unpinNodes, resetPins, perfRef }
}
