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

export interface EmbeddingProgress {
  indexed: number
  total: number
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
  const [embeddingProgress, setEmbeddingProgress] = useState<EmbeddingProgress | null>(null)

  useEffect(() => {
    if (!enabled) return

    let active = true
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    async function pollEmbeddings(): Promise<void> {
      if (!active) return
      try {
        const res = await fetch('/api/semantic-status')
        if (!active) return
        if (res.ok) {
          const status = await res.json() as { ready: boolean; indexed: number; total: number }
          if (!active) return
          if (status.ready) {
            // Both must update in same batch to avoid a frame where
            // loading=true + embeddingProgress=null shows "Connecting..."
            setEmbeddingProgress(null)
            setLoading(false)
            return
          }
          setEmbeddingProgress({ indexed: status.indexed, total: status.total })
        }
      } catch {
        // Server busy — retry
      }
      if (active) pollTimer = setTimeout(pollEmbeddings, 500)
    }

    async function fetchGraph(retryCount = 0): Promise<void> {
      if (!active) return
      try {
        const res = await fetch('/api/graph')
        if (!active) return

        if (res.ok) {
          const graph = await res.json() as GraphData
          if (active) {
            // Graph is ready — show the 3D view immediately
            setBuildProgress(null)
            setEmbeddingProgress(null)
            setData(graph)
            setLoading(false)
            // Poll embeddings in background (only needed for semantic search)
            pollEmbeddings()
          }
          return
        }

        if (res.status === 202) {
          const body = await res.json() as BuildingResponse
          if (active) {
            setBuildProgress(body.progress)
            // Keep loading=true — don't clear it during graph build phase
            // Poll again after 500ms
            pollTimer = setTimeout(fetchGraph, 500)
          }
          return
        }

        throw new Error(`HTTP ${res.status}`)
      } catch (err) {
        if (!active) return
        if (retryCount < 8) {
          // Backend might not be ready yet — retry with backoff
          const delay = Math.min(500 * Math.pow(2, retryCount), 3000)
          pollTimer = setTimeout(() => fetchGraph(retryCount + 1), delay)
          return
        }
        // After all retries, show error
        setError((err as Error).message)
        setLoading(false)
      }
    }

    fetchGraph()

    return () => {
      active = false
      if (pollTimer !== null) clearTimeout(pollTimer)
    }
  }, [enabled])

  return { data, loading, error, buildProgress, embeddingProgress }
}
