// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)
//
// Worker thread: async graph build — runs off the main Express event loop.
// Communicates via parentPort messages.

import { parentPort, workerData } from 'worker_threads'
import fsPromises from 'fs/promises'
import path from 'path'

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

export interface WorkerInput {
  vaultPath: string
}

export interface WorkerProgressMsg {
  type: 'progress'
  totalFiles: number
  processedFiles: number
}

export interface WorkerDoneMsg {
  type: 'done'
  graph: GraphData
  noteBodyMap: [string, string][]
}

export interface WorkerErrorMsg {
  type: 'error'
  message: string
}

export type WorkerMsg = WorkerProgressMsg | WorkerDoneMsg | WorkerErrorMsg

// ─── Concurrency limiter ──────────────────────────────────────────────────────

class Semaphore {
  private count: number
  private readonly waiters: Array<() => void> = []

  constructor(limit: number) { this.count = limit }

  acquire(): Promise<void> {
    if (this.count > 0) { this.count--; return Promise.resolve() }
    return new Promise<void>(resolve => this.waiters.push(resolve))
  }

  release(): void {
    if (this.waiters.length > 0) {
      this.waiters.shift()!()
    } else {
      this.count++
    }
  }
}

// ─── Vault parsing (mirrors server/index.ts) ─────────────────────────────────

function getNodeType(relPath: string): NodeType {
  const folder = relPath.split('/')[0]?.toLowerCase() ?? ''
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
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (fmMatch) {
    const inlineMatch = fmMatch[1].match(/tags:\s*\[([^\]]+)\]/)
    if (inlineMatch) {
      inlineMatch[1].split(',').forEach(t => tags.add(t.trim().replace(/['"]/g, '')))
    }
    const listMatch = fmMatch[1].match(/tags:\s*\n((?:\s+-\s+.+\n?)+)/)
    if (listMatch) {
      const items = listMatch[1].match(/-\s+(.+)/g)
      items?.forEach(item => tags.add(item.replace(/^-\s+/, '').trim()))
    }
  }
  const inlineTags = content.match(/#([a-zA-Z0-9_/-]+)/g)
  inlineTags?.forEach(t => tags.add(t.slice(1)))
  return Array.from(tags)
}

function extractWikilinks(content: string): string[] {
  const matches = content.match(/\[\[([^\]|#]+?)(?:\|[^\]]+)?\]\]/g) ?? []
  return matches.map(m => {
    const inner = m.slice(2, -2).split('|')[0].split('#')[0].trim()
    return inner.toLowerCase().replace(/\s+/g, '-')
  })
}

function extractExcerpt(content: string): string {
  const stripped = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
  return stripped
    .replace(/^#+\s+.+$/gm, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 120)
}

function extractBody(content: string): string {
  return content
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/[*_`#]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
}

// ─── Async directory walk ─────────────────────────────────────────────────────

async function walkDir(dir: string): Promise<string[]> {
  const mdFiles: string[] = []

  async function walk(d: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof fsPromises.readdir>>
    try {
      entries = await fsPromises.readdir(d, { withFileTypes: true })
    } catch {
      return
    }

    await Promise.all(entries.map(async (entry) => {
      if (entry.name.startsWith('.')) return
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isSymbolicLink()) {
        try {
          const stat = await fsPromises.stat(full)
          if (stat.isDirectory()) await walk(full)
          else if (full.endsWith('.md')) mdFiles.push(full)
        } catch { /* skip broken symlinks */ }
      } else if (entry.name.endsWith('.md')) {
        mdFiles.push(full)
      }
    }))
  }

  await walk(dir)
  return mdFiles
}

// ─── Main build ───────────────────────────────────────────────────────────────

async function buildGraphAsync(vaultPath: string): Promise<void> {
  const sem = new Semaphore(50)

  // Announce start
  parentPort!.postMessage({ type: 'progress', totalFiles: 0, processedFiles: 0 } satisfies WorkerMsg)

  // Walk directory tree
  let mdFiles: string[]
  try {
    mdFiles = await walkDir(vaultPath)
  } catch (err) {
    parentPort!.postMessage({ type: 'error', message: `Walk failed: ${String(err)}` } satisfies WorkerMsg)
    return
  }

  const totalFiles = mdFiles.length
  parentPort!.postMessage({ type: 'progress', totalFiles, processedFiles: 0 } satisfies WorkerMsg)

  const nodeMap = new Map<string, VaultNode>()
  const noteBodyMap = new Map<string, string>()
  let processedFiles = 0

  // Read all files with concurrency limiter
  await Promise.all(mdFiles.map(async (filePath) => {
    await sem.acquire()
    try {
      const relPath = path.relative(vaultPath, filePath)
      const ext = path.extname(relPath)
      const nameWithoutExt = path.basename(relPath, ext)
      const id = relPath.replace(/\.md$/, '').toLowerCase().replace(/\s+/g, '-')

      let content: string
      let stat: Awaited<ReturnType<typeof fsPromises.stat>>
      try {
        ;[content, stat] = await Promise.all([
          fsPromises.readFile(filePath, 'utf-8'),
          fsPromises.stat(filePath),
        ])
      } catch {
        return
      }

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

      processedFiles++
      // Report progress every 100 files or at the end
      if (processedFiles % 100 === 0 || processedFiles === totalFiles) {
        parentPort!.postMessage({
          type: 'progress', totalFiles, processedFiles,
        } satisfies WorkerMsg)
      }
    } finally {
      sem.release()
    }
  }))

  // Build canonical link graph
  const allIds = new Set(nodeMap.keys())
  const links: VaultLink[] = []
  const linkSet = new Set<string>()

  for (const node of nodeMap.values()) {
    for (const rawLink of node.links) {
      let targetId: string | undefined

      if (allIds.has(rawLink)) {
        targetId = rawLink
      } else {
        const linkBase = path.basename(rawLink)
        for (const id of allIds) {
          if (path.basename(id) === linkBase || id.endsWith('/' + linkBase)) {
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

  parentPort!.postMessage({
    type: 'done',
    graph: { nodes: Array.from(nodeMap.values()), links },
    noteBodyMap: Array.from(noteBodyMap.entries()),
  } satisfies WorkerMsg)
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const { vaultPath } = workerData as WorkerInput
buildGraphAsync(vaultPath).catch((err: unknown) => {
  parentPort!.postMessage({ type: 'error', message: String(err) } satisfies WorkerMsg)
})
