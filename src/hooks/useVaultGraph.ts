// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import { useState, useEffect } from 'react'

export interface GraphNode {
  id: string
  label: string
  path: string
  type: 'drop' | 'memory' | 'note' | 'tag'
  tags: string[]
  links: string[]
  excerpt: string
  createdAt: string
  modifiedAt: string
  folder: string
  // 3D position (set by force simulation)
  x?: number
  y?: number
  z?: number
  vx?: number
  vy?: number
  vz?: number
}

export interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

export interface BuildProgress {
  totalFiles: number
  processedFiles: number
}

interface BuildingResponse {
  status: 'building'
  progress: BuildProgress
}

export function useVaultGraph(enabled = true) {
  const [data, setData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [buildProgress, setBuildProgress] = useState<BuildProgress | null>(null)

  useEffect(() => {
    if (!enabled) return

    let active = true
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    async function fetchGraph(): Promise<void> {
      if (!active) return
      try {
        const res = await fetch('/api/graph')
        if (!active) return

        if (res.ok) {
          const graph = await res.json() as GraphData
          if (active) {
            // Set data first, clear build progress in a microtask so React
            // doesn't render a single frame with data=null + buildProgress=null
            // (which causes a black flash on first load)
            setBuildProgress(null)
            setData(graph)
            // Defer loading=false to give Three.js a frame to mount the scene
            requestAnimationFrame(() => {
              if (active) setLoading(false)
            })
          }
          return
        }

        if (res.status === 202) {
          const body = await res.json() as BuildingResponse
          if (active) {
            setBuildProgress(body.progress)
            setLoading(false)
            // Poll again after 500ms
            pollTimer = setTimeout(fetchGraph, 500)
          }
          return
        }

        throw new Error(`HTTP ${res.status}`)
      } catch (err) {
        if (active) {
          setError((err as Error).message)
          setLoading(false)
        }
      }
    }

    fetchGraph()

    return () => {
      active = false
      if (pollTimer !== null) clearTimeout(pollTimer)
    }
  }, [enabled])

  return { data, loading, error, buildProgress }
}
