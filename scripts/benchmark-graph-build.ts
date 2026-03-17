#!/usr/bin/env npx tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)
//
// Benchmark: measure graph build performance (sync baseline + async comparison)
// Usage: npx tsx scripts/benchmark-graph-build.ts [--async]

import fs from 'fs'
import fsPromises from 'fs/promises'
import os from 'os'
import path from 'path'

// ─── Config loading (same as server) ─────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), '.jarvis-config.json')
const FALLBACK = process.env.VAULT_PATH ?? path.join(os.homedir(), 'obsidian', 'otacon-vault')

function loadVaultPath(): string {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const cfg = JSON.parse(raw) as { vaultPath?: string }
    if (cfg.vaultPath?.trim()) return cfg.vaultPath.trim()
  } catch { /* fall through */ }
  return FALLBACK
}

// ─── Sync benchmark ──────────────────────────────────────────────────────────

function syncWalk(dir: string): string[] {
  const files: string[] = []
  function walk(d: string) {
    const entries = fs.readdirSync(d, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(d, entry.name)
      if (entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full).isDirectory())) {
        walk(full)
      } else if (entry.name.endsWith('.md')) {
        files.push(full)
      }
    }
  }
  walk(dir)
  return files
}

function runSyncBenchmark(vaultPath: string): void {
  console.log('\n=== SYNC BENCHMARK ===')
  console.log(`Vault: ${vaultPath}`)

  const t0 = Date.now()

  // Phase 1: Walk
  const t1 = Date.now()
  const files = syncWalk(vaultPath)
  const walkMs = Date.now() - t1
  console.log(`Walk:       ${walkMs}ms  (${files.length} .md files found)`)

  // Phase 2: Read + parse files
  const t2 = Date.now()
  let readOk = 0
  let readFail = 0
  for (const f of files) {
    try {
      fs.readFileSync(f, 'utf-8')
      fs.statSync(f)
      readOk++
    } catch {
      readFail++
    }
  }
  const readMs = Date.now() - t2
  console.log(`Read:       ${readMs}ms  (${readOk} ok, ${readFail} failed)`)

  const totalMs = Date.now() - t0
  console.log(`Total:      ${totalMs}ms`)

  const summary = [
    `mode=sync`,
    `vault=${vaultPath}`,
    `files=${files.length}`,
    `walkMs=${walkMs}`,
    `readMs=${readMs}`,
    `totalMs=${totalMs}`,
  ].join('\n')

  console.log('\n--- Raw ---')
  console.log(summary)
}

// ─── Async benchmark ─────────────────────────────────────────────────────────

class Semaphore {
  private count: number
  private waiters: Array<() => void> = []
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

async function asyncWalk(dir: string): Promise<string[]> {
  const files: string[] = []
  async function walk(d: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof fsPromises.readdir>>
    try { entries = await fsPromises.readdir(d, { withFileTypes: true }) } catch { return }
    await Promise.all(entries.map(async (entry) => {
      if (entry.name.startsWith('.')) return
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isSymbolicLink()) {
        try {
          const stat = await fsPromises.stat(full)
          if (stat.isDirectory()) await walk(full)
          else if (full.endsWith('.md')) files.push(full)
        } catch { /* skip broken symlinks */ }
      } else if (entry.name.endsWith('.md')) {
        files.push(full)
      }
    }))
  }
  await walk(dir)
  return files
}

async function runAsyncBenchmark(vaultPath: string): Promise<void> {
  console.log('\n=== ASYNC BENCHMARK (concurrency=50) ===')
  console.log(`Vault: ${vaultPath}`)

  const t0 = Date.now()
  const sem = new Semaphore(50)

  // Phase 1: Walk
  const t1 = Date.now()
  const files = await asyncWalk(vaultPath)
  const walkMs = Date.now() - t1
  console.log(`Walk:       ${walkMs}ms  (${files.length} .md files found)`)

  // Phase 2: Read with concurrency limit
  const t2 = Date.now()
  let readOk = 0
  let readFail = 0

  await Promise.all(files.map(async (f) => {
    await sem.acquire()
    try {
      await Promise.all([fsPromises.readFile(f, 'utf-8'), fsPromises.stat(f)])
      readOk++
    } catch {
      readFail++
    } finally {
      sem.release()
    }
  }))

  const readMs = Date.now() - t2
  console.log(`Read:       ${readMs}ms  (${readOk} ok, ${readFail} failed)`)

  const totalMs = Date.now() - t0
  console.log(`Total:      ${totalMs}ms`)

  const summary = [
    `mode=async`,
    `vault=${vaultPath}`,
    `files=${files.length}`,
    `walkMs=${walkMs}`,
    `readMs=${readMs}`,
    `totalMs=${totalMs}`,
  ].join('\n')

  console.log('\n--- Raw ---')
  console.log(summary)
}

// ─── Express responsiveness test ─────────────────────────────────────────────

async function measureServerResponseTime(url = 'http://localhost:3001/api/config'): Promise<number> {
  const t = Date.now()
  try {
    const res = await fetch(url)
    await res.text()
    return Date.now() - t
  } catch {
    return -1
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const vaultPath = loadVaultPath()

  if (!fs.existsSync(vaultPath)) {
    console.error(`ERROR: Vault path does not exist: ${vaultPath}`)
    console.error('Set VAULT_PATH env var or configure via ~/.jarvis-config.json')
    process.exit(1)
  }

  const mode = process.argv[2]

  if (mode === '--async') {
    // Check server responsiveness
    const responseMs = await measureServerResponseTime()
    if (responseMs >= 0) {
      console.log(`Server /api/config response time: ${responseMs}ms`)
    } else {
      console.log('Server not running (skipping response time check)')
    }
    await runAsyncBenchmark(vaultPath)
  } else {
    // Default: sync (before fix)
    const responseMs = await measureServerResponseTime()
    if (responseMs >= 0) {
      console.log(`Server /api/config response time: ${responseMs}ms`)
    } else {
      console.log('Server not running (skipping response time check)')
    }
    runSyncBenchmark(vaultPath)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
