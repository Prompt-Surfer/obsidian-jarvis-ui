import express from 'express'
import fs from 'fs'
import MiniSearch from 'minisearch'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

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

// ─── Vault Parsing ────────────────────────────────────────────────────────────

function getNodeType(relPath: string): NodeType {
  const parts = relPath.split('/')
  const folder = parts[0]?.toLowerCase() || ''
  if (folder === 'drops') return 'drop'
  if (folder === 'memory') return 'memory'
  return 'note'
}

function getTopFolder(relPath: string): string {
  const parts = relPath.split('/')
  return parts.length > 1 ? parts[0] : ''
}

function extractTitle(content: string, filename: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m)
  if (h1Match) return h1Match[1].trim()
  return filename
}

function extractTags(content: string): string[] {
  const tags = new Set<string>()
  // YAML frontmatter tags
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (fmMatch) {
    const tagsMatch = fmMatch[1].match(/tags:\s*\[([^\]]+)\]/)
    if (tagsMatch) {
      tagsMatch[1].split(',').forEach(t => tags.add(t.trim().replace(/['"]/g, '')))
    }
    const tagsListMatch = fmMatch[1].match(/tags:\s*\n((?:\s+-\s+.+\n?)+)/)
    if (tagsListMatch) {
      const items = tagsListMatch[1].match(/-\s+(.+)/g)
      items?.forEach(item => tags.add(item.replace(/^-\s+/, '').trim()))
    }
  }
  // Inline #tags
  const inlineTags = content.match(/#([a-zA-Z0-9_/-]+)/g)
  inlineTags?.forEach(t => tags.add(t.slice(1)))
  return Array.from(tags)
}

function extractWikilinks(content: string): string[] {
  const matches = content.match(/\[\[([^\]|#]+?)(?:\|[^\]]+)?\]\]/g) || []
  return matches.map(m => {
    const inner = m.slice(2, -2).split('|')[0].split('#')[0].trim()
    return inner.toLowerCase().replace(/\s+/g, '-')
  })
}

function extractExcerpt(content: string): string {
  // Remove frontmatter
  const stripped = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
  // Remove headings and wikilinks, get first 120 chars of text
  const text = stripped
    .replace(/^#+\s+.+$/gm, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
  return text.slice(0, 120)
}

function extractBody(content: string): string {
  // Strip frontmatter, collapse whitespace, return searchable plain text
  return content
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/[*_`#]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
}

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

interface NoteDoc {
  id: string
  title: string
  content: string
  folder: string
  tags: string[]
}

interface GraphData {
  nodes: VaultNode[]
  links: VaultLink[]
}

let cachedGraph: GraphData | null = null
let cacheTime = 0
let cachedVaultPath: string | null = null
let searchIndex: MiniSearch<NoteDoc> | null = null
let noteBodyMap = new Map<string, string>()
const CACHE_TTL = 30_000 // 30s

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

function buildGraph(vaultPath: string): GraphData {
  const now = Date.now()
  if (cachedGraph && now - cacheTime < CACHE_TTL && cachedVaultPath === vaultPath) return cachedGraph

  noteBodyMap = new Map()
  searchIndex = null

  const nodeMap = new Map<string, VaultNode>()
  const mdFiles: string[] = []

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full).isDirectory())) {
        walk(full)
      } else if (entry.name.endsWith('.md')) {
        mdFiles.push(full)
      }
    }
  }

  walk(vaultPath)

  for (const filePath of mdFiles) {
    const relPath = path.relative(vaultPath, filePath)
    const ext = path.extname(relPath)
    const nameWithoutExt = path.basename(relPath, ext)
    const id = relPath.replace(/\.md$/, '').toLowerCase().replace(/\s+/g, '-')

    let content = ''
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }

    const stat = fs.statSync(filePath)

    const node: VaultNode = {
      id,
      label: extractTitle(content, nameWithoutExt),
      path: relPath,
      type: getNodeType(relPath),
      tags: extractTags(content),
      links: extractWikilinks(content),
      excerpt: extractExcerpt(content),
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      folder: getTopFolder(relPath),
    }

    nodeMap.set(id, node)
    noteBodyMap.set(id, extractBody(content))
  }

  // Build canonical id → node lookup with fuzzy matching
  const allIds = new Set(nodeMap.keys())

  // Resolve links to actual node IDs
  const links: VaultLink[] = []
  const linkSet = new Set<string>()

  for (const node of nodeMap.values()) {
    for (const rawLink of node.links) {
      // Try to find the target node
      let targetId: string | undefined

      // Exact match first
      if (allIds.has(rawLink)) {
        targetId = rawLink
      } else {
        // Try matching just the filename part
        const linkBase = path.basename(rawLink)
        for (const id of allIds) {
          const idBase = path.basename(id)
          if (idBase === linkBase || id.endsWith('/' + linkBase)) {
            targetId = id
            break
          }
        }
      }

      if (targetId && targetId !== node.id) {
        const key = [node.id, targetId].sort().join('→')
        if (!linkSet.has(key)) {
          linkSet.add(key)
          links.push({ source: node.id, target: targetId })
        }
      }
    }
  }

  cachedGraph = {
    nodes: Array.from(nodeMap.values()),
    links,
  }
  cacheTime = now
  cachedVaultPath = vaultPath
  buildSearchIndex(cachedGraph.nodes)
  return cachedGraph
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
    cachedGraph = null
    cachedVaultPath = null
    searchIndex = null
    noteBodyMap = new Map()
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

app.get('/api/graph', (_req, res) => {
  try {
    const graph = buildGraph(loadConfig().vaultPath)
    res.json(graph)
  } catch (err) {
    console.error('Error building graph:', err)
    res.status(500).json({ error: 'Failed to build graph' })
  }
})

app.get('/api/note', (req, res) => {
  const notePath = req.query.path as string
  if (!notePath) {
    res.status(400).json({ error: 'path query param required' })
    return
  }

  const vaultPath = loadConfig().vaultPath
  const fullPath = path.join(vaultPath, notePath)
  // Security: ensure path is within vault
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
  if (!q) {
    res.json({ results: [] })
    return
  }

  const graph = buildGraph(loadConfig().vaultPath)
  const terms = q.split(/\s+/).filter(Boolean)

  const scored = graph.nodes.map(node => {
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
  if (!q) {
    res.json({ results: [] })
    return
  }

  // Ensure graph + index are built
  buildGraph(loadConfig().vaultPath)

  if (!searchIndex) {
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
  const graph = buildGraph(loadConfig().vaultPath)
  const tagSet = new Set<string>()
  graph.nodes.forEach(n => n.tags.forEach(t => tagSet.add(t)))
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
    searchIndex = null
    noteBodyMap = new Map()
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.listen(PORT, () => {
  console.log(`Jarvis API server running on http://localhost:${PORT}`)
  const cfg = loadConfig()
  console.log(`Vault: ${cfg.vaultPath}`)
  console.log(`Config: ${isConfigured() ? CONFIG_PATH : '(none — using fallback)'}`)
})

export default app
