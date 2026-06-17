// Control: measure before/after pixel diff with NO drag — isolates camera-settle +
// live-vault noise so the drag test's number is interpretable.
import { chromium } from 'playwright-core'
import fs from 'fs'
const PNG = await import('pngjs').then(m => m.PNG)
const b = await chromium.launch({ headless: true })
const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
await p.goto('http://localhost:5173/?graphShape=natural', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('canvas', { timeout: 120000 })
await p.waitForFunction(() => document.body.innerText.includes('SIM STABLE'), null, { timeout: 180000 })
await p.waitForTimeout(6000)
const clip = { x: 480, y: 120, width: 760, height: 760 }
await p.screenshot({ path: '/tmp/noise-a.png', clip })
await p.waitForTimeout(4000) // no interaction
await p.screenshot({ path: '/tmp/noise-b.png', clip })
const a = PNG.sync.read(fs.readFileSync('/tmp/noise-a.png')), c = PNG.sync.read(fs.readFileSync('/tmp/noise-b.png'))
let diff = 0; const n = a.data.length/4
for (let i=0;i<a.data.length;i+=4) if (Math.abs(a.data[i]-c.data[i])+Math.abs(a.data[i+1]-c.data[i+1])+Math.abs(a.data[i+2]-c.data[i+2])>60) diff++
console.log(JSON.stringify({ noDragNoisePct: +(diff/n*100).toFixed(1) }))
await b.close()
