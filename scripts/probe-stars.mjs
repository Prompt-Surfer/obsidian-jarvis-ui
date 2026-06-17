import { chromium } from 'playwright-core'
const b = await chromium.launch({ headless: true })
const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
await p.goto('http://localhost:5173/?graphShape=natural', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('canvas', { timeout: 120000 })
await p.waitForFunction(() => document.body.innerText.includes('SIM STABLE'), null, { timeout: 180000 })
await p.waitForTimeout(5000)
// enable stars
const starsToggled = await p.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /STARS OFF/i.test(e.textContent||''))
  if (el) { el.click(); return true } return false
})
await p.waitForTimeout(800)
// set spread to max (10)
await p.evaluate(() => {
  const r = [...document.querySelectorAll('input[type=range]')].find(r => r.min==='1' && r.max==='10')
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set
  set.call(r, '10'); r.dispatchEvent(new Event('input',{bubbles:true}))
})
await p.waitForTimeout(3500) // spread zoom + the 2s star-rescale throttle
await p.screenshot({ path: '/tmp/stars-maxspread.png' })
// also reset spread low to compare stars near
await p.evaluate(() => {
  const r = [...document.querySelectorAll('input[type=range]')].find(r => r.min==='1' && r.max==='10')
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set
  set.call(r, '2'); r.dispatchEvent(new Event('input',{bubbles:true}))
})
await p.waitForTimeout(3500)
await p.screenshot({ path: '/tmp/stars-lowspread.png' })
console.log(JSON.stringify({ starsToggled }))
await b.close()
