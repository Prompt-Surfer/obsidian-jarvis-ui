// Confirm Reset All reuses cache (applyPositions, no recompute) and an added note
// triggers change-only relax (not a full precalc).
import { chromium } from 'playwright-core'
import { writeFileSync, unlinkSync } from 'fs'
const b = await chromium.launch({ headless: true })
const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
const logs = []
p.on('console', m => { const t = m.text(); if (/natural-layout|precalc-engine/i.test(t)) logs.push(`${((Date.now())%100000)} ${t}`) })
await p.goto('http://localhost:5173/?graphShape=natural', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('canvas', { timeout: 120000 })
await p.waitForFunction(() => document.body.innerText.includes('SIM STABLE'), null, { timeout: 180000 })
await p.waitForTimeout(5000) // ensure cache saved
logs.length = 0

// --- Reset All ---
await p.evaluate(() => { const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /RESET ALL/i.test(e.textContent||'')); if (el) el.click() })
await p.waitForTimeout(2500)
const logsReset = [...logs]; logs.length = 0

// --- Add a note (change-only) ---
const NOTE = '/home/samuel/obsidian/otacon-vault/Notes/__cache_changeonly_test__.md'
writeFileSync(NOTE, '# cache change-only test\n\nlinks nowhere\n')
let changeLog = null
const t0 = Date.now()
while (Date.now() - t0 < 90000) {
  if (logs.some(l => /change-only|cache-hit|precalc-engine/.test(l))) { changeLog = logs.filter(l=>/natural-layout|precalc/.test(l)); break }
  await p.waitForTimeout(1000)
}
unlinkSync(NOTE)
await p.waitForTimeout(8000) // let removal settle too
console.log(JSON.stringify({ logsReset, changeOnlyLogs: changeLog, tailLogs: logs.slice(-6) }, null, 2))
await b.close()
