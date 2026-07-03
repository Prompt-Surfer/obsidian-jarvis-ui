// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

/**
 * Persistent cache of the natural-layout node positions.
 *
 * The natural layout is expensive to precalc (force simulation over the graph
 * core). Once settled, the positions are deterministic for a given node set, so
 * we persist them to localStorage and re-seed them on the next load. The worker
 * then takes its warm path (instant apply for an unchanged graph, or a light
 * change-only relax when a few notes were added/removed) instead of recomputing
 * from scratch. Reset All also restores from this cache rather than recomputing.
 *
 * Positions are stored as base64 of a Float32Array(3N) aligned to `ids`; a
 * signature over the sorted id set lets callers tell "same graph" from "changed
 * graph" cheaply.
 */

// Bump this version whenever the layout ALGORITHM changes (positions cached under
// an old version would otherwise replay a stale layout, since the cache key is the
// node set, not the algorithm). v8: the cache now stores the BASE layout (pre
// min-distance polish); the worker re-applies the per-tier collide on load, so the
// sliders stay reversible. v7 caches held polished coords — re-settle once.
const KEY = 'jarvis-natural-layout-v8'
const MAX_NODES = 200_000 // sanity cap; refuse absurd sizes

export interface CachedLayout {
  sig: string
  ids: string[]
  arr: Float32Array // 3N, xyz per id
}

// FNV-1a over the sorted id list + count — stable identity of a node set.
export function computeSig(ids: string[]): string {
  const sorted = [...ids].sort()
  let h = 0x811c9dc5
  for (const id of sorted) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i)
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
    }
    h ^= 0x2c // id separator
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return `${sorted.length}:${h.toString(16)}`
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[])
  }
  return btoa(bin)
}

function base64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

export function loadLayout(): CachedLayout | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const obj = JSON.parse(raw) as { sig: string; ids: string[]; pos: string }
    if (!obj?.ids || !obj.pos || !obj.sig) return null
    const arr = base64ToFloat32(obj.pos)
    if (arr.length !== obj.ids.length * 3) return null
    return { sig: obj.sig, ids: obj.ids, arr }
  } catch {
    return null
  }
}

export function saveLayout(ids: string[], arr: Float32Array): void {
  if (ids.length === 0 || ids.length > MAX_NODES || arr.length !== ids.length * 3) return
  try {
    const obj = { sig: computeSig(ids), ids, pos: bufToBase64(arr.buffer.slice(0) as ArrayBuffer) }
    localStorage.setItem(KEY, JSON.stringify(obj))
  } catch {
    // quota exceeded or storage unavailable — caching is best-effort
  }
}

export function clearLayout(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
