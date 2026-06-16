// Spread-adjust settle benchmark: after the graph settles, change the SPREAD
// slider and measure time until SIM STABLE returns, with __stutter capture.
import { chromium } from 'playwright-core'

const TARGET_SPREAD = Number(process.argv[2] || 7.0)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const logs = []
page.on('console', (m) => { const t = m.text(); if (/precalc-engine|spread-engine|error/i.test(t)) logs.push(t) })
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message))

await page.goto('http://localhost:5173/?graphShape=natural', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas', { timeout: 120000 })
await page.waitForFunction(() => document.body.innerText.includes('SIM STABLE'), null, { timeout: 180000 })
await page.waitForTimeout(4000)

// open settings panel if collapsed — the SPREAD slider must be in the DOM
const gearOpen = await page.evaluate(() => !!document.body.innerText.match(/SPREAD:/))
if (!gearOpen) {
  // try clicking the gear (⚙) — best-effort
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter(e => e.textContent === '⚙')
    if (els[0]) (els[0]).click()
  })
  await page.waitForTimeout(500)
}

// locate the SPREAD range input: min=1 max=10, current value ~ default 4
const found = await page.evaluate((target) => {
  const ranges = [...document.querySelectorAll('input[type=range]')]
  const cand = ranges.find(r => r.min === '1' && r.max === '10' && Math.abs(parseFloat(r.value) - 4.0) < 0.6)
    || ranges.find(r => r.min === '1' && r.max === '10')
  if (!cand) return { ok: false, count: ranges.length }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(cand, String(target))
  cand.dispatchEvent(new Event('input', { bubbles: true }))
  cand.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true, from: cand.defaultValue, to: target }
}, TARGET_SPREAD)

const t0 = Date.now()
await page.evaluate(() => window.__stutter.start())
// SIM STABLE should drop, then return when resettled
let dropped = false
let tStable = null
for (let i = 0; i < 480; i++) {
  const stable = await page.evaluate(() => document.body.innerText.includes('SIM STABLE')).catch(() => true)
  if (!dropped && !stable) dropped = true
  if (dropped && stable) { tStable = Date.now() - t0; break }
  await page.waitForTimeout(125)
}
const stutter = await page.evaluate(() => window.__stutter.stop())
await page.waitForTimeout(3000)
await page.screenshot({ path: `/tmp/spread-${TARGET_SPREAD}.png` })

console.log(JSON.stringify({
  targetSpread: TARGET_SPREAD,
  slider: found,
  sawDrop: dropped,
  resettleMs: tStable,
  stutter: { frames: stutter.frames, p50: stutter.p50Ms, p95: stutter.p95Ms, p99: stutter.p99Ms, max: stutter.maxMs, severe: stutter.severeFrames },
  logs,
}, null, 2))
await browser.close()
