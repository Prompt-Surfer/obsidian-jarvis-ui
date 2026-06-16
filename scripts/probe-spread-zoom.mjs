import { chromium } from 'playwright-core'
const b = await chromium.launch({ headless: true })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
const logs = []
p.on('console', (m) => { const t = m.text(); if (/spread-scale|precalc-engine|error/i.test(t)) logs.push(t) })
p.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message))
await p.goto('http://localhost:5173/?graphShape=natural', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('canvas', { timeout: 120000 })
await p.waitForFunction(() => document.body.innerText.includes('SIM STABLE'), null, { timeout: 180000 })
await p.waitForTimeout(4000)
await p.screenshot({ path: '/tmp/zoom-before.png' })

const setSpread = async (target) => {
  return p.evaluate((t) => {
    const ranges = [...document.querySelectorAll('input[type=range]')]
    const cand = ranges.find(r => r.min === '1' && r.max === '10')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(cand, String(t)); cand.dispatchEvent(new Event('input', { bubbles: true }))
    return performance.now()
  }, target)
}

// zoom in: 4 -> 8 (2x). Measure stutter for a short window right after.
await p.evaluate(() => window.__stutter.start())
const tA = Date.now()
await setSpread(8.0)
await p.waitForTimeout(2500) // lerp glide window
const sA = await p.evaluate(() => window.__stutter.stop())
await p.screenshot({ path: '/tmp/zoom-8x.png' })

// zoom out: 8 -> 2
await p.evaluate(() => window.__stutter.start())
await setSpread(2.0)
await p.waitForTimeout(2500)
const sB = await p.evaluate(() => window.__stutter.stop())
await p.screenshot({ path: '/tmp/zoom-2x.png' })

const ui = await p.evaluate(() => document.body.innerText.slice(0,120))
console.log(JSON.stringify({
  zoomInWindow: { p50: sA.p50Ms, p95: sA.p95Ms, max: sA.maxMs, frames: sA.frames },
  zoomOutWindow: { p50: sB.p50Ms, p95: sB.p95Ms, max: sB.maxMs, frames: sB.frames },
  nodes: ui.match(/NODES: (\d+)/)?.[1], visible: ui.match(/VISIBLE: (\d+)/)?.[1],
  logs,
}, null, 2))
await b.close()
