import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
void __filename // ESM compat shim

const app = express()
const PORT = 3001
const VAULT_PATH = process.env.VAULT_PATH || '~/obsidian/otacon-vault'

app.use(express.json())
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
  next()
})

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

interface GraphData {
  nodes: VaultNode[]
  links: VaultLink[]
}

let cachedGraph: GraphData | null = null
let cacheTime = 0
const CACHE_TTL = 30_000 // 30s

function buildGraph(): GraphData {
  const now = Date.now()
  if (cachedGraph && now - cacheTime < CACHE_TTL) return cachedGraph

  const nodeMap = new Map<string, VaultNode>()
  const mdFiles: string[] = []

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.md')) {
        mdFiles.push(full)
      }
    }
  }

  walk(VAULT_PATH)

  for (const filePath of mdFiles) {
    const relPath = path.relative(VAULT_PATH, filePath)
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
  return cachedGraph
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/graph', (_req, res) => {
  try {
    const graph = buildGraph()
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

  const fullPath = path.join(VAULT_PATH, notePath)
  // Security: ensure path is within vault
  const resolved = path.resolve(fullPath)
  const vaultResolved = path.resolve(VAULT_PATH)
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

  const graph = buildGraph()
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

app.get('/api/tags', (_req, res) => {
  const graph = buildGraph()
  const tagSet = new Set<string>()
  graph.nodes.forEach(n => n.tags.forEach(t => tagSet.add(t)))
  res.json({ tags: Array.from(tagSet).sort() })
})

app.listen(PORT, () => {
  console.log(`Jarvis API server running on http://localhost:${PORT}`)
  console.log(`Vault: ${VAULT_PATH}`)
})

export default app
