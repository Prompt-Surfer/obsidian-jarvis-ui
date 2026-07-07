// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import { useState, useEffect, useRef, useCallback } from 'react'
import type { GraphNode, GraphLink, GraphData } from './useVaultGraph'
import type { GraphShape } from '../shapes/types'
import { loadLayout, saveLayout } from '../lib/layoutCache'

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

// Trees shape: trunk/branch skeleton line segment (world space, a→b)
export interface TreeBranch {
  ax: number; ay: number; az: number; bx: number; by: number; bz: number
}

// Trees shape: folder-name label at a tree base
export interface TreeLabel {
  text: string; x: number; y: number; z: number
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

export function useForce3D(graphData: GraphData | null, graphShape: GraphShape = 'natural', topNTags?: number, tagBoxSizeScale?: number, minDist?: { regular: number; super: number; ultra: number }) {
  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map())
  const [simDone, setSimDone] = useState(false)
  const [tagBoxes, setTagBoxes] = useState<TagBox[]>([])
  const [treeBranches, setTreeBranches] = useState<TreeBranch[]>([])
  const [treeLabels, setTreeLabels] = useState<TreeLabel[]>([])
  // Natural precalc progress (0-100) while the worker silently solves the core
  // layout; null whenever no precalc is running
  const [layoutProgress, setLayoutProgress] = useState<number | null>(null)
  const [shapeError, setShapeError] = useState<{ shape: string; message: string; seq: number } | null>(null)
  const shapeErrorSeqRef = useRef(0)
  const workerRef = useRef<Worker | null>(null)

  // Track current spread so worker init can use it (not stale default)
  const spreadRef = useRef(2.0)

  // Latest per-tier min-distance, so worker init bakes the persisted settings into the
  // precalc'd layout (not the default). Held as a ref so changing it doesn't re-init.
  const minDistRef = useRef(minDist)
  minDistRef.current = minDist

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
  // Only persist the layout to cache on a layout-defining 'end' (precalc or
  // add/remove relax) — not on transient drag/reheat/spread/filter emits, so the
  // cache stays the canonical layout that reload + Reset All restore.
  const cacheNextEndRef = useRef(false)

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

      if (type === 'treeBranches') {
        setTreeBranches(e.data.treeBranches ?? [])
        setTreeLabels(e.data.treeLabels ?? [])
        return
      }

      if (type === 'layoutProgress') {
        setLayoutProgress(typeof e.data.pct === 'number' ? e.data.pct : null)
        return
      }

      if (type === 'shapeError') {
        // Imported/community shape failed to fetch or compile — bump seq so
        // repeated failures of the same shape still notify.
        setShapeError({ shape: e.data.shape ?? '', message: e.data.message ?? 'failed to load', seq: shapeErrorSeqRef.current++ })
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
          setLayoutProgress(null)
          // Persist the settled natural layout so the next load/reset reuses it
          // instead of recomputing. Only on a layout-defining settle, and only the
          // worker-provided BASE positions (the layout WITHOUT min-distance polish
          // baked in) — caching the displayed/polished coords would make lowering
          // the min-dist sliders irreversible after a reload.
          const base: Float32Array | null = e.data.basePositions instanceof Float32Array ? e.data.basePositions : null
          if (cacheNextEndRef.current && graphShape === 'natural' && base && live.ids.length > 0 && base.length === live.ids.length * 3) {
            saveLayout(live.ids, base)
            cacheNextEndRef.current = false
          }
        }
      }
    }

    // Decide the warm-start positions handed to the worker:
    //  - natural, fresh load OR switching in from another shape → use the persistent
    //    cache (the in-memory channel is empty on reload, or holds the *other* shape's
    //    positions on a switch, so we must not reuse it). With cache, the worker
    //    applies it instantly / change-only relaxes; without, it precalcs.
    //  - natural, same-graph re-init (data add/remove) → use current live positions.
    //  - non-natural → use current live positions when present.
    const live0 = livePositionsRef.current
    const liveValid = !!(live0.arr && live0.ids.length > 0 && live0.arr.length === live0.ids.length * 3)
    let existingPositions: Array<{ id: string; x: number; y: number; z: number }> | undefined
    const fromLive = () => live0.ids.map((id, i) => ({ id, x: live0.arr![i * 3], y: live0.arr![i * 3 + 1], z: live0.arr![i * 3 + 2] }))

    if (graphShape === 'natural' && (isShapeOnlyChange || !liveValid)) {
      const cached = loadLayout()
      if (cached) {
        live0.ids = cached.ids
        live0.arr = cached.arr
        live0.tiers = cached.ids.map(() => 'regular') // tiers re-announced by the worker's nodeOrder
        live0.version = 0
        existingPositions = cached.ids.map((id, i) => ({ id, x: cached.arr[i * 3], y: cached.arr[i * 3 + 1], z: cached.arr[i * 3 + 2] }))
      } else {
        existingPositions = undefined // no cache → full precalc (don't reuse stale/other-shape positions)
      }
    } else {
      existingPositions = liveValid ? fromLive() : undefined
    }

    if (DEBUG) performance.mark('t1-worker-init-send')

    // An init defines/updates the layout (precalc or add/remove relax) → its
    // settle should refresh the cache.
    cacheNextEndRef.current = graphShape === 'natural'

    setLayoutProgress(null)
    worker.postMessage({
      type: 'init',
      nodes: graphData.nodes.map((n: GraphNode) => ({ id: n.id, folder: n.folder ?? '', tags: n.tags ?? [] })),
      links: graphData.links.map((l: GraphLink) => ({
        source: typeof l.source === 'string' ? l.source : (l.source as GraphNode).id,
        target: typeof l.target === 'string' ? l.target : (l.target as GraphNode).id,
      })),
      graphShape,
      existingPositions,
      reason: isShapeOnlyChange ? 'shape' : 'data',
      spread: spreadRef.current,
      minDist: minDistRef.current ?? { regular: 12, super: 35, ultra: 70 },
      topN: topNTags ?? 24,
      tagBoxSizeScale: tagBoxSizeScale ?? 1.0,
    })

    return () => {
      worker.terminate()
    }
  }, [graphData, graphShape, topNTags, tagBoxSizeScale])

  const reheat = useCallback(() => {
    cacheNextEndRef.current = true // a reheat produces a fresh canonical layout worth caching
    workerRef.current?.postMessage({ type: 'reheat' })
    setSimDone(false)
  }, [])

  const setSpread = useCallback((value: number) => {
    spreadRef.current = value
    cacheNextEndRef.current = false // spread is a transient zoom, not a layout change
    workerRef.current?.postMessage({ type: 'setSpread', spread: value })
    setSimDone(false)
  }, [])

  const setFilter = useCallback((visibleIds: string[]) => {
    // Note: setFilter(all-active) runs on every load — must NOT suppress caching.
    workerRef.current?.postMessage({ type: 'setFilter', visibleIds })
  }, [])

  // Per-tier minimum node distance (collide radius) from the UI sliders.
  const setMinDist = useCallback((regular: number, sup: number, ultra: number) => {
    cacheNextEndRef.current = false // tuning min-distance nudges the layout — not a canonical resettle
    workerRef.current?.postMessage({ type: 'setMinDist', regular, super: sup, ultra })
  }, [])

  // Live particle motion for animated imported shapes (casberry time-driven formations)
  const setShapeMotion = useCallback((enabled: boolean) => {
    workerRef.current?.postMessage({ type: 'setShapeMotion', enabled })
  }, [])

  // Reset All: restore the cached canonical layout instead of recomputing.
  // Reapplies positions in the worker (no simulation) and rebases spread.
  const resetLayout = useCallback((spread: number) => {
    const cached = loadLayout()
    cacheNextEndRef.current = false
    spreadRef.current = spread
    const w = workerRef.current
    if (!w || !cached) return false
    w.postMessage({ type: 'applyPositions', ids: cached.ids, positions: cached.arr, spread })
    setSimDone(true)
    return true
  }, [])

  const pinNodes = useCallback((pinned: Array<{ id: string; x: number; y: number; z: number }>) => {
    cacheNextEndRef.current = false // dragging is transient — keep the cached canonical layout
    workerRef.current?.postMessage({ type: 'pinNodes', pinned })
  }, [])

  const moveNodes = useCallback((pinned: Array<{ id: string; x: number; y: number; z: number }>) => {
    cacheNextEndRef.current = false // dragging is transient — keep the cached canonical layout
    workerRef.current?.postMessage({ type: 'moveNodes', pinned })
  }, [])

  const unpinNodes = useCallback((ids: string[]) => {
    workerRef.current?.postMessage({ type: 'unpinNodes', ids })
  }, [])

  const resetPins = useCallback(() => {
    workerRef.current?.postMessage({ type: 'resetPins' })
  }, [])

  return { positions, livePositions: livePositionsRef, simDone, tagBoxes, treeBranches, treeLabels, layoutProgress, shapeError, reheat, setSpread, setFilter, setMinDist, setShapeMotion, pinNodes, moveNodes, unpinNodes, resetPins, resetLayout, perfRef }
}
