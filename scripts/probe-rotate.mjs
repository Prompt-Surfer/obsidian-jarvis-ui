import { chromium } from 'playwright-core'
const b = await chromium.launch({ headless: true })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
const errs = []
p.on('pageerror', e => errs.push(e.message))
await p.goto('http://localhost:5173/?graphShape=natural', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('canvas', { timeout: 120000 })
await p.waitForFunction(() => document.body.innerText.includes('SIM STABLE'), null, { timeout: 180000 })
await p.waitForTimeout(4000)

const canvas = p.locator('canvas[data-engine^="three.js"]')
const box = await canvas.boundingBox()
const cx = Math.round(box.x + box.width / 2)
const cy = Math.round(box.y + box.height / 2)
const clip = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.25, width: box.width * 0.5, height: box.height * 0.5 }

const shots = []
// sustained vertical drag upward in many steps, screenshot every ~300px of travel
await p.mouse.move(cx, cy)
await p.mouse.down({ button: 'left' })
let y = cy
const stepPx = 30, total = 2400 // ~2.4k px vertical drag = well past a 180° pole stop
for (let moved = 0; moved < total; moved += stepPx) {
  y -= stepPx
  // wrap the cursor back to center when it nears the top edge, keep dragging
  if (y < box.y + 40) { await p.mouse.move(cx, y); y = cy; }
  await p.mouse.move(cx, y, { steps: 2 })
  if (moved % 600 === 0) { await p.screenshot({ path: `/tmp/rot-${moved}.png`, clip }); shots.push(`/tmp/rot-${moved}.png`) }
}
await p.mouse.up({ button: 'left' })
await p.waitForTimeout(800)
await p.screenshot({ path: '/tmp/rot-final.png', clip }); shots.push('/tmp/rot-final.png')

// byte-compare consecutive shots: all-distinct => rotation never froze at a pole
import('fs').then(() => {})
const fs = await import('fs')
const bufs = shots.map(s => fs.readFileSync(s))
const distinct = []
for (let i = 1; i < bufs.length; i++) distinct.push(!(bufs[i].length === bufs[i-1].length && bufs[i].compare(bufs[i-1]) === 0))
console.log(JSON.stringify({ shots: shots.length, consecutiveDistinct: distinct, allDistinct: distinct.every(Boolean), errors: errs.slice(0,5) }))
await b.close()
