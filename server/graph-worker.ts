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
  tagDirect?: number // tag nodes only: notes carrying the tag directly (0 = implied ancestor)
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
  linkingProgress?: { linked: number; total: number }
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
  // Pre-build basename→id index for O(1) fuzzy lookups (replaces O(N) linear scan per link).
  // Iterated in sorted order so ambiguous basenames ([[MOC]] — the vault has dozens of
  // MOC.md files) resolve to a stable run-independent winner: nodeMap insertion order is
  // async-read-completion order, which let link targets (and thus a couple of note tiers)
  // flip between otherwise identical builds.
  const allIds = new Set(nodeMap.keys())
  const basenameIndex = new Map<string, string>()
  const suffixIndex = new Map<string, string>()
  for (const id of Array.from(allIds).sort()) {
    const base = path.basename(id)
    // First match wins (same as original linear scan behavior)
    if (!basenameIndex.has(base)) basenameIndex.set(base, id)
    // Also index with folder prefix for '/' suffix matching
    if (!suffixIndex.has(base)) suffixIndex.set(base, id)
  }

  const links: VaultLink[] = []
  const linkSet = new Set<string>()
  const nodeArr = Array.from(nodeMap.values())
  const totalNodes = nodeArr.length
  let linkedNodes = 0

  for (const node of nodeArr) {
    for (const rawLink of node.links) {
      let targetId: string | undefined

      if (allIds.has(rawLink)) {
        targetId = rawLink
      } else {
        const linkBase = path.basename(rawLink)
        targetId = basenameIndex.get(linkBase)
      }

      if (targetId && targetId !== node.id) {
        const key = [node.id, targetId].sort().join('→')
        if (!linkSet.has(key)) {
          linkSet.add(key)
          links.push({ source: node.id, target: targetId })
        }
      }
    }
    linkedNodes++
    if (linkedNodes % 500 === 0 || linkedNodes === totalNodes) {
      parentPort!.postMessage({
        type: 'progress', totalFiles, processedFiles: totalFiles,
        linkingProgress: { linked: linkedNodes, total: totalNodes },
      } as WorkerMsg)
    }
  }

  buildTagLayer(nodeMap, nodeArr, links, linkSet)

  parentPort!.postMessage({
    type: 'done',
    graph: { nodes: Array.from(nodeMap.values()), links },
    noteBodyMap: Array.from(noteBodyMap.entries()),
  } satisfies WorkerMsg)
}

// ─── Tag-node layer ───────────────────────────────────────────────────────────
// Promote every distinct tag to a first-class graph node. Ids are prefixed
// ('tag:memory/fact') so they can never collide with note ids (relative paths).
// Tag strings are validated (dump noise rejected) and case-folded — variants
// like 'RAG'/'rag' merge into one node keyed lower-case, labelled with the
// dominant casing. Implied parents are materialised — 'memory/fact' guarantees
// a 'memory' node even when no note carries bare #memory. Edge families:
//   note → tag            for every (cleaned) tag on every note
//   child tag → parent    'tag:memory/fact' → 'tag:memory'
//   MOC ↔ hub tag         folder-index notes linked to the tag they mirror
// The force worker tiers tag nodes by hierarchy (root with children that notes
// carry directly → ultranode, other roots with children + nested → supernode,
// flat leaf → regular), making hub tags hubs-of-hubs.

export const TAG_NODE_ID_PREFIX = 'tag:'

function normalizeTagName(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '')
}

// ── Tag validity ──
// Code blocks and config dumps get misparsed as tags: GitHub issue refs
// ('#47377'), CSS colours ('#00d4ff'), dates ('#2026/03/16'), YAML fragments
// with spaces. A '/'-segment is noise when it carries no alphabetic signal
// (pure digits/punctuation) or is a hex string containing at least one digit
// (pure-letter words like 'beef' survive). Checked per segment so nested noise
// ('0/gif') can't re-materialise a bogus root via ancestor implication.
const TAG_CHARSET_RE = /^[A-Za-z0-9_/-]+$/

function isNoiseSegment(seg: string): boolean {
  if (!/[A-Za-z]/.test(seg)) return true
  return /^[0-9a-fA-F]+$/.test(seg) && /\d/.test(seg)
}

// Canonical (lower-case) tag key, or null when the string is not a plausible
// Obsidian tag. Case-insensitive so 'RAG'/'rag'/'OpenClaw'/'openclaw' merge.
function cleanTagKey(raw: string): string | null {
  const t = normalizeTagName(raw)
  if (!t || !TAG_CHARSET_RE.test(t)) return null
  if (t.split('/').some(isNoiseSegment)) return null
  return t.toLowerCase()
}

interface TagAgg { direct: number; createdMs: number; modifiedMs: number; notes: string[] }

function buildTagLayer(
  nodeMap: Map<string, VaultNode>,
  noteArr: VaultNode[],
  links: VaultLink[],
  linkSet: Set<string>,
): void {
  // Clean every note's tag array in place: drop dump noise, fold case variants
  // into canonical keys, dedupe — while voting on the display casing of every
  // hierarchy level so 'tag:rag' can be labelled '#RAG'. Raw counts are kept
  // for the corrupted-note guard in MOC linking.
  const caseVotes = new Map<string, Map<string, number>>()
  const rawTagCounts = new Map<string, number>()
  for (const note of noteArr) {
    rawTagCounts.set(note.id, note.tags.length)
    const cleaned: string[] = []
    const seen = new Set<string>()
    for (const raw of note.tags) {
      const key = cleanTagKey(raw)
      if (!key) continue
      if (!seen.has(key)) { seen.add(key); cleaned.push(key) }
      const rawParts = normalizeTagName(raw).split('/')
      const keyParts = key.split('/')
      for (let i = 1; i <= keyParts.length; i++) {
        const levelKey = keyParts.slice(0, i).join('/')
        const levelRaw = rawParts.slice(0, i).join('/')
        let votes = caseVotes.get(levelKey)
        if (!votes) { votes = new Map(); caseVotes.set(levelKey, votes) }
        votes.set(levelRaw, (votes.get(levelRaw) ?? 0) + 1)
      }
    }
    note.tags = cleaned
  }

  // Aggregate per-tag note counts and date ranges (tag "exists" from its first note)
  const tagAgg = new Map<string, TagAgg>()
  const getAgg = (tag: string): TagAgg => {
    let agg = tagAgg.get(tag)
    if (!agg) { agg = { direct: 0, createdMs: Infinity, modifiedMs: -Infinity, notes: [] }; tagAgg.set(tag, agg) }
    return agg
  }
  for (const note of noteArr) {
    const c = Date.parse(note.createdAt)
    const m = Date.parse(note.modifiedAt)
    for (const tag of note.tags) {
      const agg = getAgg(tag)
      agg.direct++
      agg.notes.push(note.id)
      if (Number.isFinite(c) && c < agg.createdMs) agg.createdMs = c
      if (Number.isFinite(m) && m > agg.modifiedMs) agg.modifiedMs = m
    }
  }

  // Materialise implied ancestors so every hierarchy level exists as a node
  for (const tag of Array.from(tagAgg.keys())) {
    const parts = tag.split('/')
    for (let i = 1; i < parts.length; i++) getAgg(parts.slice(0, i).join('/'))
  }

  // Direct-child counts + roll dates up the hierarchy (a parent tag appears on
  // the timeline as early as its earliest descendant)
  const childCount = new Map<string, number>()
  for (const [tag, agg] of tagAgg) {
    const parts = tag.split('/')
    if (parts.length > 1) {
      const parent = parts.slice(0, -1).join('/')
      childCount.set(parent, (childCount.get(parent) ?? 0) + 1)
    }
    for (let i = 1; i < parts.length; i++) {
      const anc = tagAgg.get(parts.slice(0, i).join('/'))!
      if (agg.createdMs < anc.createdMs) anc.createdMs = agg.createdMs
      if (agg.modifiedMs > anc.modifiedMs) anc.modifiedMs = agg.modifiedMs
    }
  }

  const nowIso = new Date().toISOString()
  const msToIso = (ms: number): string => (Number.isFinite(ms) ? new Date(ms).toISOString() : nowIso)
  const addLink = (source: string, target: string): boolean => {
    const key = [source, target].sort().join('→')
    if (linkSet.has(key)) return false
    linkSet.add(key)
    links.push({ source, target })
    return true
  }

  // Display casing: most-voted raw variant wins; ties break to the
  // lexicographically smallest (uppercase-first, so acronyms like 'RAG' win).
  // Every level has votes because prefixes are voted alongside full tags.
  const displayName = (key: string): string => {
    const votes = caseVotes.get(key)
    if (!votes) return key
    let best = key
    let bestCount = -1
    for (const [variant, count] of votes) {
      if (count > bestCount || (count === bestCount && variant < best)) { best = variant; bestCount = count }
    }
    return best
  }

  // Tag nodes (sorted for deterministic node order) + hierarchy edges
  for (const tag of Array.from(tagAgg.keys()).sort()) {
    const agg = tagAgg.get(tag)!
    const id = TAG_NODE_ID_PREFIX + tag
    if (nodeMap.has(id)) continue // paranoia: never clobber a real note id
    const slash = tag.lastIndexOf('/')
    const parentId = slash > 0 ? TAG_NODE_ID_PREFIX + tag.slice(0, slash) : null
    const kids = childCount.get(tag) ?? 0
    nodeMap.set(id, {
      id,
      label: `#${displayName(tag)}`,
      path: '',
      type: 'tag',
      tags: [tag],
      links: parentId ? [parentId] : [],
      excerpt: `Tag · ${agg.direct} note${agg.direct === 1 ? '' : 's'}${kids > 0 ? ` · ${kids} sub-tag${kids === 1 ? '' : 's'}` : ''}`,
      createdAt: msToIso(agg.createdMs),
      modifiedAt: msToIso(agg.modifiedMs),
      folder: '#tags',
      tagDirect: agg.direct,
    })
    if (parentId) addLink(id, parentId)
  }

  // note → tag edges (note.tags is already cleaned + canonical)
  for (const note of noteArr) {
    for (const tag of note.tags) {
      addLink(note.id, TAG_NODE_ID_PREFIX + tag)
    }
  }

  const { pairs, newEdges } = linkMocsToHubTags(noteArr, links, tagAgg, childCount, rawTagCounts, addLink)
  console.log(`[tag-layer] ${tagAgg.size} tags · MOC↔tag: ${pairs} pairs matched, ${newEdges} new edges`)
}

// ─── MOC ↔ hub-tag linking ────────────────────────────────────────────────────
// Most of the vault's MOCs (folder-index notes) mirror a hub tag: memories/moc
// IS #memory, research/moc/trading IS #hive/domain/trading. Both nodes stay
// (non-destructive) — an edge pulls each MOC and its twin tag into one visual
// hub while both remain navigable. Only super/ultra-tier tags (nested, or
// roots with children) are ever targets; the plain #moc tag never is. These
// are note↔tag edges, so the force worker's degree-based note tiering ignores
// them — note/MOC tiers stay byte-identical.

const MOC_LEAF = 'moc'
// A real MOC carries a handful of tags. Corrupted dump notes (tool-result
// ledgers) can carry hundreds of misparsed fragments including a literal
// 'moc' — treat those as noise, never as MOCs.
const MOC_MAX_RAW_TAGS = 40
const MOC_MAX_CLEAN_TAGS = 20

function singularize(word: string): string | null {
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 1 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return null
}

function linkMocsToHubTags(
  noteArr: VaultNode[],
  links: VaultLink[],
  tagAgg: Map<string, TagAgg>,
  childCount: Map<string, number>,
  rawTagCounts: Map<string, number>,
  addLink: (source: string, target: string) => boolean,
): { pairs: number; newEdges: number } {
  // Hub = super/ultra tier under the force worker's hierarchy rule.
  const isHub = (key: string): boolean =>
    key !== MOC_LEAF && tagAgg.has(key) && (key.includes('/') || (childCount.get(key) ?? 0) > 0)

  // leaf segment → nested hub tags carrying it ('fact' → ['memory/fact'])
  const leafIndex = new Map<string, string[]>()
  for (const key of tagAgg.keys()) {
    if (!key.includes('/') || !isHub(key)) continue
    const leaf = key.slice(key.lastIndexOf('/') + 1)
    let arr = leafIndex.get(leaf)
    if (!arr) { arr = []; leafIndex.set(leaf, arr) }
    arr.push(key)
  }

  // MOC candidates: folder-index filename convention or an explicit #moc tag
  // (tag-count-guarded against corrupted dumps).
  const mocIds = new Set<string>()
  for (const note of noteArr) {
    if (note.id.split('/').pop() !== MOC_LEAF && !note.tags.includes(MOC_LEAF)) continue
    if ((rawTagCounts.get(note.id) ?? 0) > MOC_MAX_RAW_TAGS || note.tags.length > MOC_MAX_CLEAN_TAGS) continue
    mocIds.add(note.id)
  }

  // Wikilink neighbourhoods of the MOCs (note↔note edges only — `links`
  // already contains tag edges at this point and those must not count).
  const neighbours = new Map<string, Set<string>>()
  const addNeighbour = (moc: string, other: string): void => {
    let set = neighbours.get(moc)
    if (!set) { set = new Set(); neighbours.set(moc, set) }
    set.add(other)
  }
  for (const l of links) {
    if (l.source.startsWith(TAG_NODE_ID_PREFIX) || l.target.startsWith(TAG_NODE_ID_PREFIX)) continue
    if (mocIds.has(l.source)) addNeighbour(l.source, l.target)
    if (mocIds.has(l.target)) addNeighbour(l.target, l.source)
  }

  // Co-location signal: how many of the tag's direct notes are wikilink
  // neighbours of the MOC. Disambiguates leaf collisions — research/moc/health
  // indexes notes tagged #hive/domain/health, not #topic/health.
  const overlap = (key: string, mocId: string): number => {
    const nb = neighbours.get(mocId)
    if (!nb || nb.size === 0) return 0
    let n = 0
    for (const id of tagAgg.get(key)?.notes ?? []) if (nb.has(id)) n++
    return n
  }
  const pickBest = (keys: string[], mocId: string): string =>
    keys
      .map(key => ({ key, ov: overlap(key, mocId), direct: tagAgg.get(key)?.direct ?? 0 }))
      .sort((a, b) => b.ov - a.ov || b.direct - a.direct || (a.key < b.key ? -1 : 1))[0].key

  let pairs = 0
  let newEdges = 0
  for (const note of noteArr) {
    if (!mocIds.has(note.id)) continue

    // Identity candidates: filename slug, parent dir, top folder, label slug —
    // each raw + singularized, minus 'moc' itself.
    const parts = note.id.split('/')
    const sources = [
      parts[parts.length - 1],
      parts.length > 1 ? parts[parts.length - 2] : '',
      parts.length > 1 ? parts[0] : '',
      note.label.trim().toLowerCase().replace(/\s+/g, '-'),
    ]
    const candidates: string[] = []
    for (const c of sources) {
      if (!c || c === MOC_LEAF) continue
      if (!candidates.includes(c)) candidates.push(c)
      const s = singularize(c)
      if (s && s !== MOC_LEAF && !candidates.includes(s)) candidates.push(s)
    }

    const ownHubs = note.tags.filter(isHub)
    let target: string | undefined

    // 1. Own tag that IS the MOC's identity (full name or leaf segment) —
    //    memories/moc is tagged #memory.
    for (const cand of candidates) {
      if (ownHubs.includes(cand)) { target = cand; break }
      const leafHits = ownHubs.filter(t => t.includes('/') && t.slice(t.lastIndexOf('/') + 1) === cand)
      if (leafHits.length > 0) { target = pickBest(leafHits, note.id); break }
    }
    // 2. Identity vs the whole tag space: a hub with that full name
    //    (projects/moc → #project), else the best nested hub whose leaf
    //    matches (facts/moc → #memory/fact, research/moc/trading →
    //    #hive/domain/trading).
    if (!target) {
      for (const cand of candidates) {
        if (isHub(cand)) { target = cand; break }
        const leafHits = leafIndex.get(cand)
        if (leafHits && leafHits.length > 0) { target = pickBest(leafHits, note.id); break }
      }
    }
    // 3. Any own hub tag — the author's explicit classification — when the
    //    MOC's name matches nothing.
    if (!target && ownHubs.length > 0) target = pickBest(ownHubs, note.id)
    // 4. Compound: own root hub + own flat tag reconstructing an existing
    //    nested hub (#topic + #openclaw → #topic/openclaw).
    if (!target) {
      const roots = ownHubs.filter(t => !t.includes('/')).sort()
      const flats = note.tags.filter(t => t !== MOC_LEAF && !t.includes('/')).sort()
      outer: for (const r of roots) {
        for (const f of flats) {
          if (isHub(`${r}/${f}`)) { target = `${r}/${f}`; break outer }
        }
      }
    }

    if (!target) continue // no hub twin (e.g. lessons/moc) — expected, skip
    pairs++
    if (addLink(note.id, TAG_NODE_ID_PREFIX + target)) newEdges++
  }
  return { pairs, newEdges }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const { vaultPath } = workerData as WorkerInput
buildGraphAsync(vaultPath).catch((err: unknown) => {
  parentPort!.postMessage({ type: 'error', message: String(err) } satisfies WorkerMsg)
})
