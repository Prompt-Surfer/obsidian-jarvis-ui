import { test, expect, Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'

/**
 * Stutter measurement harness — quantifies frame-pacing jank per graph pattern.
 *
 * Not a pass/fail visual test: it drives the app through the scenarios where the
 * Natural pattern stutters (shape forming after a pattern switch, and manual
 * right-drag of a node while the sim is hot) and captures frame-interval
 * statistics via the `window.__stutter` meter (src/lib/stutterMeter.ts).
 *
 * Output: a comparison table on stdout + benchmarks/stutter-report.json.
 * The numbers to watch are p95/p99/max frame interval, longFrames and
 * stutterTimePct — NOT average FPS, which hides hitches.
 *
 * Run (dev server must be up — see CLAUDE.md):
 *   npx playwright test tests/stutter-measure.spec.ts --timeout 300000
 */

test.setTimeout(300000)

interface StutterReport {
  durationMs: number
  frames: number
  avgFps: number
  baselineMs: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
  longFrames: number
  severeFrames: number
  stutterTimePct: number
  longTasks: { count: number; totalMs: number; maxMs: number }
}

// Patterns to compare. Natural is the suspect; Saturn/Sun are the controls
// (shape-driven modes disable charge/link/collide forces in the worker).
const PATTERNS = ['Saturn', 'Sun', 'Natural'] as const

const FORMING_CAPTURE_MS = 7000 // covers pattern switch + shape forming + settling
const DRAG_CAPTURE_MS = 5000    // continuous right-drag wiggle

async function waitForGraphReady(page: Page) {
  await page.waitForSelector('canvas', { timeout: 30000 })
  try {
    await page.waitForSelector('text=SIM STABLE', { timeout: 60000 })
  } catch {
    await page.waitForTimeout(5000) // graph may still be usable without the HUD badge
  }
  await page.waitForTimeout(1000)
}

async function openSettings(page: Page) {
  // Settings panel is open by default (persisted in localStorage) — only toggle if closed
  const shapeBtn = page.locator('button', { hasText: 'Natural' }).first()
  if (await shapeBtn.isVisible().catch(() => false)) return
  await page.locator('button', { hasText: '⚙' }).first().click()
  await shapeBtn.waitFor({ state: 'visible', timeout: 5000 })
}

async function switchPattern(page: Page, label: string) {
  const btn = page.locator('button', { hasText: label }).first()
  await btn.click()
}

// window.__stutter is installed by src/lib/stutterMeter.ts (imported in main.tsx)
type StutterWindow = Window & { __stutter: { start(): void; stop(): StutterReport } }

async function startCapture(page: Page) {
  await page.evaluate(() => (window as unknown as StutterWindow).__stutter.start())
}

async function stopCapture(page: Page): Promise<StutterReport> {
  return await page.evaluate(() => (window as unknown as StutterWindow).__stutter.stop())
}

// Continuous right-drag wiggle around the canvas centre — keeps the sim pinned+hot
// (moveNodes messages every mousemove) exactly like a user rearranging nodes.
async function wiggleDrag(page: Page, durationMs: number) {
  // Two canvases exist (main three.js scene + minimap) — target the WebGL one
  const box = await page.locator('canvas[data-engine^="three.js"]').boundingBox()
  if (!box) throw new Error('canvas not found')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'right' })
  const start = Date.now()
  let i = 0
  while (Date.now() - start < durationMs) {
    const angle = i * 0.35
    await page.mouse.move(
      cx + Math.cos(angle) * 180,
      cy + Math.sin(angle) * 120,
      { steps: 4 },
    )
    i++
  }
  await page.mouse.up({ button: 'right' })
}

function fmtRow(label: string, r: StutterReport): string {
  return [
    label.padEnd(22),
    `${r.avgFps}`.padStart(4),
    `${r.p50Ms}`.padStart(7),
    `${r.p95Ms}`.padStart(7),
    `${r.p99Ms}`.padStart(7),
    `${r.maxMs}`.padStart(8),
    `${r.longFrames}`.padStart(5),
    `${r.severeFrames}`.padStart(7),
    `${r.stutterTimePct}%`.padStart(8),
    `${r.longTasks.count} (${r.longTasks.maxMs}ms max)`.padStart(18),
  ].join(' ')
}

test('measure frame stutter per pattern (forming + drag)', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await waitForGraphReady(page)
  await openSettings(page)

  const results: Record<string, StutterReport> = {}

  for (const pattern of PATTERNS) {
    // Phase 1: shape forming — start capture, then switch so the capture spans
    // the worker re-init, position streaming and lerp convergence
    await startCapture(page)
    await switchPattern(page, pattern)
    await page.waitForTimeout(FORMING_CAPTURE_MS)
    results[`${pattern} / forming`] = await stopCapture(page)

    // Phase 2: manual node drag while pattern is active
    await startCapture(page)
    await wiggleDrag(page, DRAG_CAPTURE_MS)
    results[`${pattern} / drag`] = await stopCapture(page)

    await page.waitForTimeout(1500) // let sim settle before next pattern
  }

  // Idle baseline on the last pattern (Natural) — camera and sim at rest
  await page.waitForTimeout(2000)
  await startCapture(page)
  await page.waitForTimeout(3000)
  results['Natural / idle'] = await stopCapture(page)

  const header = [
    'scenario'.padEnd(22), ' fps', '    p50', '    p95', '    p99', '     max',
    ' long', ' severe', ' stutter', '         longTasks',
  ].join(' ')
  console.log('\n=== Stutter comparison (frame intervals, ms) ===')
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const [label, r] of Object.entries(results)) console.log(fmtRow(label, r))
  console.log('\nlong  = frames >1.5× baseline (dropped frames)')
  console.log('severe = frames >50ms (visible hitches)')
  console.log('stutter = % of wall time spent inside long frames\n')

  const outPath = path.join(process.cwd(), 'benchmarks', 'stutter-report.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2))
  console.log(`Report written to ${outPath}`)

  // Sanity only — this spec measures, it does not gate
  for (const r of Object.values(results)) expect(r.frames).toBeGreaterThan(0)
})
