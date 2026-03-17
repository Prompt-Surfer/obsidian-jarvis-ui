// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import express from 'express'
import fs from 'fs'
import MiniSearch from 'minisearch'
import os from 'os'
import path from 'path'
import { Worker } from 'worker_threads'
import { fileURLToPath } from 'url'
import { buildEmbeddingIndex, semanticSearch, getSemanticStatus, resetEmbeddingIndex } from './embeddings.js'
import type { WorkerMsg, WorkerProgressMsg } from './graph-worker.js'

const __filename = fileURLToPath(import.meta.url)
void __filename // ESM compat shim

const app = express()
const PORT = 3001

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), '.jarvis-config.json')
const FALLBACK_VAULT_PATH = process.env.JARVIS_VAULT_PATH || process.env.VAULT_PATH || path.join(os.homedir(), 'obsidian', 'otacon-vault')

interface JarvisConfig {
  vaultPath: string
}

function loadConfig(): JarvisConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const cfg = JSON.parse(raw) as Partial<JarvisConfig>
    if (cfg.vaultPath && typeof cfg.vaultPath === 'string' && cfg.vaultPath.trim()) {
      return { vaultPath: cfg.vaultPath.trim() }
    }
  } catch {
    // config missing or malformed — fall through
  }
  return { vaultPath: FALLBACK_VAULT_PATH }
}

function isConfigured(): boolean {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const cfg = JSON.parse(raw) as Partial<JarvisConfig>
    return !!(cfg.vaultPath && typeof cfg.vaultPath === 'string' && cfg.vaultPath.trim())
  } catch {
    return false
  }
}

function getSuggestedPaths(): string[] {
  const platform = process.platform
  const homedir = os.homedir()
  const username = os.userInfo().username
  if (platform === 'win32') {
    const paths = [
      `C:\\Users\\${username}\\Documents\\`,
      `C:\\Users\\${username}\\Documents\\Obsidian`,
    ]
    if (process.env.APPDATA) paths.push(`${process.env.APPDATA}\\Obsidian`)
    return paths
  } else if (platform === 'darwin') {
    return [
      `/Users/${username}/Documents/`,
      `/Users/${username}/Library/Mobile Documents/iCloud~md~obsidian/Documents/`,
      `/Users/${username}/Documents/Obsidian`,
    ]
  } else {
    return [
      `${homedir}/obsidian/`,
      `${homedir}/Documents/`,
      `${homedir}/Documents/obsidian`,
    ]
  }
}

app.use(express.json())
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
  next()
})
app.options('*', (_req, res) => res.sendStatus(200))

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeType = 'drop' | 'memory' | 'note' | 'tag'

interface VaultNode {
  id: string
  label: string
  path: string
  type: NodeType
  tags: string[]
  links: string[]
  excerpt: string
  createdAt: string
  modifiedAt: string
  folder: string
}

interface VaultLink {
  source: string
  target: string
}

interface GraphData {
  nodes: VaultNode[]
  links: VaultLink[]
}

// ─── Build state ─────────────────────────────────────────────────────────────

interface BuildState {
  status: 'idle' | 'building' | 'ready' | 'error'
  progress: { totalFiles: number; processedFiles: number }
  retries: number
  errorMessage?: string
}

let buildState: BuildState = {
  status: 'idle',
  progress: { totalFiles: 0, processedFiles: 0 },
  retries: 0,
}

let activeWorker: Worker | null = null

// ─── Graph cache ──────────────────────────────────────────────────────────────

interface NoteDoc {
  id: string
  title: string
  content: string
  folder: string
  tags: string[]
}

let cachedGraph: GraphData | null = null
let cacheTime = 0
let cachedVaultPath: string | null = null
let searchIndex: MiniSearch<NoteDoc> | null = null
let noteBodyMap = new Map<string, string>()
const CACHE_TTL = 5 * 60_000 // 5 min — async builds are triggered explicitly

function buildSearchIndex(nodes: VaultNode[]): void {
  const ms = new MiniSearch<NoteDoc>({
    fields: ['title', 'content'],
    storeFields: ['title', 'folder', 'tags'],
    searchOptions: { boost: { title: 2 }, fuzzy: 0.2, prefix: true },
  })
  ms.addAll(nodes.map(n => ({
    id: n.id,
    title: n.label,
    content: noteBodyMap.get(n.id) ?? '',
    folder: n.folder,
    tags: n.tags,
  })))
  searchIndex = ms
}

// ─── Worker management ────────────────────────────────────────────────────────

const MAX_RETRIES = 3
const WORKER_PATH = fileURLToPath(new URL('./graph-worker.ts', import.meta.url))

function handleWorkerFailure(vaultPath: string): void {
  buildState.retries++
  if (buildState.retries > MAX_RETRIES) {
    console.error(`[graph-worker] Max retries (${MAX_RETRIES}) exceeded — giving up`)
    buildState.status = 'error'
    buildState.errorMessage = `Worker failed after ${MAX_RETRIES} retries`
    return
  }
  const delay = 1000 * Math.pow(2, buildState.retries - 1)
  console.warn(`[graph-worker] Restarting in ${delay}ms (retry ${buildState.retries}/${MAX_RETRIES})`)
  setTimeout(() => startGraphBuild(vaultPath), delay)
}

function startGraphBuild(vaultPath: string): void {
  if (buildState.status === 'building') return

  buildState.status = 'building'
  buildState.progress = { totalFiles: 0, processedFiles: 0 }

  console.log(`[graph-worker] Starting build: ${vaultPath}`)

  const worker = new Worker(WORKER_PATH, {
    workerData: { vaultPath },
    // Inherit the tsx loader so the worker can execute TypeScript
    execArgv: [...process.execArgv],
  })
  activeWorker = worker

  worker.on('message', (msg: WorkerMsg) => {
    if (msg.type === 'progress') {
      const p = msg as WorkerProgressMsg
      buildState.progress = { totalFiles: p.totalFiles, processedFiles: p.processedFiles }
    } else if (msg.type === 'done') {
      cachedGraph = msg.graph
      cacheTime = Date.now()
      cachedVaultPath = vaultPath
      noteBodyMap = new Map(msg.noteBodyMap)
      buildSearchIndex(cachedGraph.nodes)
      buildState.status = 'ready'
      buildState.retries = 0
      activeWorker = null
      console.log(`[graph-worker] Done — ${cachedGraph.nodes.length} nodes, ${cachedGraph.links.length} links`)
      triggerEmbeddingBuild()
    } else if (msg.type === 'error') {
      console.error(`[graph-worker] Build error: ${msg.message}`)
      buildState.status = 'idle'
      activeWorker = null
      handleWorkerFailure(vaultPath)
    }
  })

  worker.on('error', (err) => {
    console.error(`[graph-worker] Uncaught error: ${err.message}`)
    buildState.status = 'idle'
    activeWorker = null
    handleWorkerFailure(vaultPath)
  })

  worker.on('exit', (code) => {
    if (code !== 0 && buildState.status === 'building') {
      console.error(`[graph-worker] Exited with code ${code}`)
      buildState.status = 'idle'
      activeWorker = null
      handleWorkerFailure(vaultPath)
    }
  })
}

function isCacheValid(vaultPath: string): boolean {
  return !!(cachedGraph && Date.now() - cacheTime < CACHE_TTL && cachedVaultPath === vaultPath)
}

// ─── Vault parsing (for /api/config/validate) ─────────────────────────────────

function makeSnippet(body: string, query: string): string {
  const lc = body.toLowerCase()
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)

  let bestIdx = -1
  for (const w of words) {
    const idx = lc.indexOf(w)
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx
  }

  const start = bestIdx === -1 ? 0 : Math.max(0, bestIdx - 40)
  const end = Math.min(body.length, start + 120)
  let snippet = (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '')

  for (const w of words) {
    snippet = snippet.replace(
      new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
      '<mark>$1</mark>',
    )
  }
  return snippet
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/config', (_req, res) => {
  const configured = isConfigured()
  res.json({
    configured,
    vaultPath: configured ? loadConfig().vaultPath : null,
    platform: process.platform,
    suggestedPaths: getSuggestedPaths(),
  })
})

app.post('/api/config', (req, res) => {
  const { vaultPath } = req.body as { vaultPath?: string }
  if (!vaultPath || typeof vaultPath !== 'string' || !vaultPath.trim()) {
    res.status(400).json({ error: 'vaultPath required' })
    return
  }
  const trimmed = vaultPath.trim()
  try {
    const stat = fs.statSync(trimmed)
    if (!stat.isDirectory()) {
      res.status(400).json({ error: 'Path is not a directory' })
      return
    }
  } catch {
    res.status(400).json({ error: 'Path does not exist' })
    return
  }
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ vaultPath: trimmed }, null, 2), 'utf-8')
    // Reset all state so next /api/graph triggers a fresh build
    cachedGraph = null
    cachedVaultPath = null
    cacheTime = 0
    searchIndex = null
    noteBodyMap = new Map()
    buildState = { status: 'idle', progress: { totalFiles: 0, processedFiles: 0 }, retries: 0 }
    if (activeWorker) {
      void activeWorker.terminate()
      activeWorker = null
    }
    resetEmbeddingIndex()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.get('/api/config/validate', (req, res) => {
  const vaultPath = req.query.path as string
  if (!vaultPath) {
    res.status(400).json({ error: 'path query param required' })
    return
  }
  try {
    const stat = fs.statSync(vaultPath)
    if (!stat.isDirectory()) {
      res.json({ valid: false, noteCount: 0, error: 'Path is not a directory' })
      return
    }
  } catch {
    res.json({ valid: false, noteCount: 0, error: 'Path does not exist' })
    return
  }
  let noteCount = 0
  function countMd(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full).isDirectory())) {
          countMd(full)
        } else if (entry.name.endsWith('.md')) {
          noteCount++
        }
      }
    } catch { /* skip unreadable dirs */ }
  }
  countMd(vaultPath)
  if (noteCount === 0) {
    res.json({ valid: false, noteCount: 0, error: 'No .md files found in this directory' })
    return
  }
  res.json({ valid: true, noteCount })
})

// ─── Graph endpoint (async) ───────────────────────────────────────────────────

app.get('/api/graph', (_req, res) => {
  const vaultPath = loadConfig().vaultPath

  if (isCacheValid(vaultPath)) {
    res.json(cachedGraph)
    return
  }

  if (buildState.status === 'error') {
    res.status(500).json({ error: buildState.errorMessage ?? 'Graph build failed' })
    return
  }

  if (buildState.status !== 'building') {
    startGraphBuild(vaultPath)
  }

  res.status(202).json({
    status: 'building',
    progress: buildState.progress,
  })
})

// ─── Graph status endpoint ────────────────────────────────────────────────────

app.get('/api/graph/status', (_req, res) => {
  res.json({
    status: buildState.status,
    progress: buildState.progress,
    cached: cachedGraph !== null,
    nodeCount: cachedGraph?.nodes.length ?? 0,
    linkCount: cachedGraph?.links.length ?? 0,
  })
})

app.get('/api/note', (req, res) => {
  const notePath = req.query.path as string
  if (!notePath) {
    res.status(400).json({ error: 'path query param required' })
    return
  }

  const vaultPath = loadConfig().vaultPath
  const fullPath = path.join(vaultPath, notePath)
  const resolved = path.resolve(fullPath)
  const vaultResolved = path.resolve(vaultPath)
  if (!resolved.startsWith(vaultResolved)) {
    res.status(403).json({ error: 'Access denied' })
    return
  }

  try {
    const content = fs.readFileSync(resolved, 'utf-8')
    res.json({ content, path: notePath })
  } catch {
    res.status(404).json({ error: 'Note not found' })
  }
})

app.get('/api/search', (req, res) => {
  const q = (req.query.q as string || '').toLowerCase().trim()
  if (!q || !cachedGraph) {
    res.json({ results: [] })
    return
  }

  const terms = q.split(/\s+/).filter(Boolean)

  const scored = cachedGraph.nodes.map(node => {
    let score = 0
    const titleLower = node.label.toLowerCase()
    const excerptLower = node.excerpt.toLowerCase()
    const tagsLower = node.tags.map(t => t.toLowerCase())

    for (const term of terms) {
      if (titleLower.includes(term)) score += 10
      if (tagsLower.some(t => t.includes(term.replace(/^#/, '')))) score += 8
      if (excerptLower.includes(term)) score += 3
      if (node.id.includes(term)) score += 5
    }

    return { id: node.id, score }
  })

  const results = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(s => s.id)

  res.json({ results })
})

app.get('/api/search/content', (req, res) => {
  const q = (req.query.q as string || '').trim()
  const limit = Math.min(parseInt(req.query.limit as string || '10', 10), 20)
  if (!q || !searchIndex) {
    res.json({ results: [] })
    return
  }

  const hits = searchIndex.search(q, { limit: limit * 2 })
  const results = hits.slice(0, limit).map(hit => {
    const body = noteBodyMap.get(hit.id) ?? ''
    return {
      id: hit.id,
      title: hit.title as string,
      folder: hit.folder as string,
      tags: hit.tags as string[],
      snippet: makeSnippet(body, q),
      score: hit.score,
      matchType: 'content' as const,
    }
  })

  res.json({ results })
})

app.get('/api/tags', (_req, res) => {
  if (!cachedGraph) {
    res.json({ tags: [] })
    return
  }
  const tagSet = new Set<string>()
  cachedGraph.nodes.forEach(n => n.tags.forEach(t => tagSet.add(t)))
  res.json({ tags: Array.from(tagSet).sort() })
})

app.post('/api/note', (req, res) => {
  const { path: notePath, content } = req.body as { path: string; content: string }
  if (!notePath || typeof content !== 'string') {
    res.status(400).json({ error: 'path and content required' })
    return
  }

  const vaultPath = loadConfig().vaultPath
  const fullPath = path.join(vaultPath, notePath)
  const resolved = path.resolve(fullPath)
  const vaultResolved = path.resolve(vaultPath)
  if (!resolved.startsWith(vaultResolved)) {
    res.status(403).json({ error: 'Access denied' })
    return
  }

  try {
    fs.writeFileSync(resolved, content, 'utf-8')
    // Invalidate cache so next read reflects changes
    cachedGraph = null
    cacheTime = 0
    searchIndex = null
    noteBodyMap = new Map()
    buildState = { status: 'idle', progress: { totalFiles: 0, processedFiles: 0 }, retries: 0 }
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ─── Semantic Search ───────────────────────────────────────────────────────────

function triggerEmbeddingBuild(): void {
  if (!cachedGraph) return
  const notes = cachedGraph.nodes.map(n => ({
    id: n.id,
    label: n.label,
    content: noteBodyMap.get(n.id) ?? '',
    excerpt: n.excerpt,
    mtime: n.modifiedAt,
  }))
  buildEmbeddingIndex(notes).catch(err => {
    console.error('[embeddings] Index build failed:', err)
  })
}

app.get('/api/semantic-search', async (req, res) => {
  const q = (req.query.q as string || '').trim()
  if (!q) {
    res.json({ results: [], ready: getSemanticStatus().ready })
    return
  }

  if (!cachedGraph) {
    res.json({ results: [], ready: false })
    return
  }

  const notes = cachedGraph.nodes.map(n => ({
    id: n.id,
    label: n.label,
    content: noteBodyMap.get(n.id) ?? '',
    excerpt: n.excerpt,
    mtime: n.modifiedAt,
  }))

  try {
    const result = await semanticSearch(q, notes)
    res.json(result)
  } catch (err) {
    console.error('[semantic-search] Error:', err)
    res.status(500).json({ error: 'Semantic search failed', ready: false })
  }
})

app.get('/api/semantic-status', (_req, res) => {
  res.json(getSemanticStatus())
})

app.listen(PORT, () => {
  console.log(`Jarvis API server running on http://localhost:${PORT}`)
  const cfg = loadConfig()
  console.log(`Vault: ${cfg.vaultPath}`)
  console.log(`Config: ${isConfigured() ? CONFIG_PATH : '(none — using fallback)'}`)

  startGraphBuild(cfg.vaultPath)
})

export default app
