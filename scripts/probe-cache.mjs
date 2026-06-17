// Verify natural-layout cache: first load precalcs + caches; reload reuses cache
// (instant, no recompute); Reset All reuses cache; the layout is identical.
import { chromium } from 'playwright-core'
import fs from 'fs'
const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } })
const p = await ctx.newPage()
const logs = []
p.on('console', m => { const t = m.text(); if (/natural-layout|precalc-engine|error/i.test(t)) logs.push(t) })
p.on('pageerror', e => logs.push('ERR: ' + e.message))

const settle = async () => {
  const t0 = Date.now()
  await p.waitForFunction(() => document.body.innerText.includes('SIM STABLE'), null, { timeout: 180000 })
  return Date.now() - t0
}
const clip = { x: 480, y: 140, width: 760, height: 720 }

// clear any prior cache for a clean first-load precalc
await p.goto('http://localhost:5173/?graphShape=natural', { waitUntil: 'domcontentloaded' })
await p.evaluate(() => localStorage.removeItem('jarvis-natural-layout-v2'))
await p.reload({ waitUntil: 'domcontentloaded' })
await p.waitForSelector('canvas', { timeout: 120000 })
const t1 = await settle()
await p.waitForTimeout(5000)
await p.screenshot({ path: '/tmp/cache-firstload.png', clip })
const logsFirst = [...logs]; logs.length = 0

// RELOAD — should hit cache (instant, no precalc)
await p.reload({ waitUntil: 'domcontentloaded' })
await p.waitForSelector('canvas', { timeout: 120000 })
const t2 = await settle()
await p.waitForTimeout(5000)
await p.screenshot({ path: '/tmp/cache-reload.png', clip })
const logsReload = [...logs]; logs.length = 0

// RESET ALL — find the [ RESET ALL ] button and click; should reuse cache
const resetClicked = await p.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /RESET ALL/i.test(e.textContent || ''))
  if (el) { (el).click(); return true }
  return false
})
await p.waitForTimeout(3000)
await p.screenshot({ path: '/tmp/cache-resetall.png', clip })
const logsReset = [...logs]

const eq = (a, c) => { const x = fs.readFileSync(a), y = fs.readFileSync(c); return x.length === y.length && x.compare(y) === 0 }
console.log(JSON.stringify({
  firstLoadSettleMs: t1, reloadSettleMs: t2,
  logsFirst, logsReload, resetClicked, logsReset,
  reloadMatchesFirst: eq('/tmp/cache-firstload.png', '/tmp/cache-reload.png'),
}, null, 2))
await b.close()
