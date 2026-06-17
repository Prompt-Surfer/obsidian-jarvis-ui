// Drag must NOT collapse the shape: pixel-diff before vs after a node drag should
// be SMALL (only the dragged node moved), not large (whole-graph collapse).
import { chromium } from 'playwright-core'
import fs from 'fs'
const PNG = await import('pngjs').then(m => m.PNG)
const b = await chromium.launch({ headless: true })
const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
const logs = []
p.on('console', m => { const t = m.text(); if (/natural-layout|error/i.test(t)) logs.push(t) })
await p.goto('http://localhost:5173/?graphShape=natural', { waitUntil: 'domcontentloaded' })
await p.evaluate(() => localStorage.removeItem('jarvis-natural-layout-v2'))
await p.reload({ waitUntil: 'domcontentloaded' })
await p.waitForSelector('canvas', { timeout: 120000 })
await p.waitForFunction(() => document.body.innerText.includes('SIM STABLE'), null, { timeout: 180000 })
await p.waitForTimeout(6000)
const clip = { x: 480, y: 120, width: 760, height: 760 }
await p.screenshot({ path: '/tmp/dragfix-before.png', clip })

// right-drag a node near center-left (where clusters are) a moderate distance
const box = await p.locator('canvas[data-engine^="three.js"]').first().boundingBox()
const sx = Math.round(box.x + box.width * 0.45), sy = Math.round(box.y + box.height * 0.5)
await p.mouse.move(sx, sy)
await p.mouse.down({ button: 'right' })

await p.mouse.move(sx + 70, sy - 40, { steps: 15 })
await p.mouse.up({ button: "right" }); await p.mouse.move(40, 40); await p.waitForTimeout(500)
await p.waitForTimeout(3000)
await p.screenshot({ path: '/tmp/dragfix-after.png', clip })

const a = PNG.sync.read(fs.readFileSync('/tmp/dragfix-before.png'))
const c = PNG.sync.read(fs.readFileSync('/tmp/dragfix-after.png'))
let diff = 0; const n = a.data.length / 4
for (let i = 0; i < a.data.length; i += 4) {
  if (Math.abs(a.data[i]-c.data[i]) + Math.abs(a.data[i+1]-c.data[i+1]) + Math.abs(a.data[i+2]-c.data[i+2]) > 60) diff++
}
console.log(JSON.stringify({ mismatchPct: +(diff/n*100).toFixed(1), interpretation: (diff/n*100) < 8 ? 'OK: localized (no collapse)' : 'COLLAPSE: whole graph moved', logs: logs.slice(-4) }))
await b.close()
