// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import fs from 'fs'
import os from 'os'
import path from 'path'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface EmbeddingEntry {
  mtime: string
  embedding: number[]
}

interface EmbeddingCache {
  version: number
  model: string
  entries: Record<string, EmbeddingEntry>
}

export interface SemanticResult {
  id: string
  label: string
  score: number
  excerpt: string
}

export interface SemanticStatus {
  ready: boolean
  indexed: number
  total: number
  model: string
}

// ─── State ─────────────────────────────────────────────────────────────────────

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'
const CACHE_PATH = path.join(os.homedir(), '.jarvis-embeddings.json')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipeline: any = null
let cache: EmbeddingCache = { version: 1, model: MODEL_NAME, entries: {} }
let indexReady = false
let indexedCount = 0
let totalCount = 0

// ─── Pipeline ──────────────────────────────────────────────────────────────────

async function ensurePipeline(): Promise<void> {
  if (pipeline) return
  const { pipeline: createPipeline } = await import('@xenova/transformers')
  pipeline = await createPipeline('feature-extraction', MODEL_NAME)
}

async function getEmbedding(text: string): Promise<number[]> {
  await ensurePipeline()
  const output = await pipeline(text, { pooling: 'mean', normalize: true })
  return Array.from(output.data as Float32Array)
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ─── Cache I/O ─────────────────────────────────────────────────────────────────

function loadCache(): void {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as EmbeddingCache
    if (parsed.version === 1 && parsed.model === MODEL_NAME) {
      cache = parsed
    }
  } catch {
    // No cache or invalid — start fresh
  }
}

function saveCache(): void {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache), 'utf-8')
  } catch (err) {
    console.error('[embeddings] Failed to write cache:', err)
  }
}

// ─── Index Building ────────────────────────────────────────────────────────────

interface NoteInput {
  id: string
  label: string
  content: string
  excerpt: string
  mtime: string
}

export async function buildEmbeddingIndex(notes: NoteInput[]): Promise<void> {
  loadCache()
  totalCount = notes.length
  indexedCount = 0
  indexReady = false

  console.log(`[embeddings] Building index for ${notes.length} notes...`)

  for (const note of notes) {
    indexedCount++

    // Skip if cache hit and mtime unchanged
    const cached = cache.entries[note.id]
    if (cached && cached.mtime === note.mtime) {
      continue
    }

    // Build embedding text: title repeated for weight + first 500 chars of content
    const snippet = note.content.slice(0, 500)
    const text = `${note.label} ${note.label}\n${snippet}`

    try {
      const embedding = await getEmbedding(text)
      cache.entries[note.id] = { mtime: note.mtime, embedding }
    } catch (err) {
      console.error(`[embeddings] Failed to embed "${note.id}":`, err)
    }

    // Periodic save every 50 notes
    if (indexedCount % 50 === 0) {
      saveCache()
      console.log(`[embeddings] Progress: ${indexedCount}/${totalCount}`)
    }
  }

  // Remove stale entries
  const noteIds = new Set(notes.map(n => n.id))
  for (const id of Object.keys(cache.entries)) {
    if (!noteIds.has(id)) delete cache.entries[id]
  }

  saveCache()
  indexReady = true
  console.log(`[embeddings] Index ready: ${Object.keys(cache.entries).length} embeddings cached`)
}

// ─── Search ────────────────────────────────────────────────────────────────────

export async function semanticSearch(query: string, notes: NoteInput[], limit = 10): Promise<{ results: SemanticResult[]; ready: boolean }> {
  if (!indexReady) {
    return { results: [], ready: false }
  }

  const queryEmbedding = await getEmbedding(query)

  const scored: { id: string; score: number }[] = []
  for (const [id, entry] of Object.entries(cache.entries)) {
    const score = cosineSimilarity(queryEmbedding, entry.embedding)
    scored.push({ id, score })
  }

  scored.sort((a, b) => b.score - a.score)

  const noteMap = new Map(notes.map(n => [n.id, n]))
  const results: SemanticResult[] = scored.slice(0, limit).map(s => {
    const note = noteMap.get(s.id)
    return {
      id: s.id,
      label: note?.label ?? s.id,
      score: Math.round(s.score * 100) / 100,
      excerpt: note?.excerpt ?? '',
    }
  })

  return { results, ready: true }
}

export function getSemanticStatus(): SemanticStatus {
  return {
    ready: indexReady,
    indexed: indexedCount,
    total: totalCount,
    model: MODEL_NAME,
  }
}

export function resetEmbeddingIndex(): void {
  indexReady = false
  indexedCount = 0
  totalCount = 0
}
