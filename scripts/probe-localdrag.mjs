// Verify localized relax: drag a node far; neighbourhood follows, far graph stays.
// Split the clip into "near drag" and "far" halves and compare pixel-diff: near
// should change (node + neighbours move), far should be ~unchanged (no collapse).
import { chromium } from 'playwright-core'
import fs from 'fs'
const PNG = await import('pngjs').then(m => m.PNG)
const b = await chromium.launch({ headless: true })
const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
const logs = []
p.on('console', m => { const t = m.text(); if (/error/i.test(t)) logs.push(t) })
await p.goto('http://localhost:5173/?graphShape=natural', { waitUntil: 'domcontentloaded' })
await p.evaluate(() => localStorage.removeItem('jarvis-natural-layout-v2'))
await p.reload({ waitUntil: 'domcontentloaded' })
await p.waitForSelector('canvas', { timeout: 120000 })
await p.waitForFunction(() => document.body.innerText.includes('SIM STABLE'), null, { timeout: 180000 })
await p.waitForTimeout(6000)
await p.screenshot({ path: '/tmp/ld-before.png' })

const box = await p.locator('canvas[data-engine^="three.js"]').first().boundingBox()
const sx = Math.round(box.x + box.width * 0.45), sy = Math.round(box.y + box.height * 0.5)
await p.mouse.move(sx, sy)
await p.mouse.down({ button: 'right' })
await p.mouse.move(sx + 150, sy - 80, { steps: 18 })
await p.mouse.move(sx + 300, sy - 160, { steps: 18 })
await p.screenshot({ path: '/tmp/ld-during.png' })  // mid-drag: neighbours should be trailing
await p.mouse.up({ button: 'right' })
await p.mouse.move(40, 40); await p.waitForTimeout(2500)
await p.screenshot({ path: '/tmp/ld-after.png' })

// far-region diff: right third of the canvas (away from the drag at 45%)
const a = PNG.sync.read(fs.readFileSync('/tmp/ld-before.png'))
const c = PNG.sync.read(fs.readFileSync('/tmp/ld-after.png'))
const W = a.width, H = a.height
const region = (x0, x1, y0, y1) => {
  let diff = 0, tot = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4
    tot++
    if (Math.abs(a.data[i]-c.data[i])+Math.abs(a.data[i+1]-c.data[i+1])+Math.abs(a.data[i+2]-c.data[i+2]) > 60) diff++
  }
  return +(diff/tot*100).toFixed(1)
}
// "far" = far-left third (drag pulls rightward from 45%, so left edge is undisturbed graph)
console.log(JSON.stringify({
  farLeftThirdDiffPct: region(Math.round(W*0.30), Math.round(W*0.42), Math.round(H*0.25), Math.round(H*0.85)),
  logs,
}))
await b.close()
