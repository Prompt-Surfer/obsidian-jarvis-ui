#!/usr/bin/env node
/**
 * record-demo.cjs — Option 1: Playwright headless video recording.
 *
 * Boots a headless Chromium against the running dev server, drives a short
 * scripted tour of the graph (settle → rotate camera → play timelapse), records
 * it to WebM, then transcodes to MP4 with ffmpeg. Fully deterministic — safe to
 * regenerate on every release. No visible display needed.
 *
 * Usage:
 *   npm run record                       # 1080p, ~25s tour, http://localhost:5173
 *   DEMO_URL=http://localhost:5176 npm run record
 *   DEMO_SECONDS=40 DEMO_W=2560 DEMO_H=1440 npm run record
 *   DEMO_KEEP_WEBM=1 npm run record      # keep the raw .webm too
 *
 * Requires the dev server to be running already (npm run dev).
 */
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')
const { chromium } = require('playwright-core')

const URL = process.env.DEMO_URL || 'http://localhost:5173'
const W = parseInt(process.env.DEMO_W || '1920', 10)
const H = parseInt(process.env.DEMO_H || '1080', 10)
const SETTLE_MS = parseInt(process.env.DEMO_SETTLE_MS || '8000', 10)
const TOUR_SECONDS = parseInt(process.env.DEMO_SECONDS || '25', 10)
const KEEP_WEBM = process.env.DEMO_KEEP_WEBM === '1'

const OUT_DIR = path.join(__dirname, '..', 'recordings')
const TMP_DIR = path.join(OUT_DIR, 'tmp')

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const mp4Path = path.join(OUT_DIR, `demo-${stamp}.mp4`)

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true })

  console.log(`▶ Recording ${W}x${H} tour of ${URL} (~${TOUR_SECONDS}s)…`)
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: TMP_DIR, size: { width: W, height: H } },
  })
  const page = await context.newPage()

  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  console.log(`  · settling graph (${SETTLE_MS}ms)…`)
  await page.waitForTimeout(SETTLE_MS)

  const budgetMs = TOUR_SECONDS * 1000
  const start = Date.now()

  // Manual camera rotation via drag — guaranteed motion regardless of settings.
  const cx = Math.floor(W / 2)
  const cy = Math.floor(H / 2)
  console.log('  · rotating camera…')
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  const steps = 60
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    await page.mouse.move(cx + Math.cos(angle) * 320, cy + Math.sin(angle) * 180)
    await page.waitForTimeout(40)
  }
  await page.mouse.up()

  // Try to trigger the timelapse playback for the rest of the budget.
  try {
    const playBtn = page.locator('[title="Play timelapse"]').first()
    if (await playBtn.count()) {
      console.log('  · playing timelapse…')
      await playBtn.click({ timeout: 2000 })
    }
  } catch (e) {
    console.log('  · (no timelapse button, continuing)')
  }

  const remaining = budgetMs - (Date.now() - start)
  if (remaining > 0) await page.waitForTimeout(remaining)

  // Closing the context flushes and finalizes the video file.
  const video = page.video()
  await context.close()
  await browser.close()

  const webmPath = video ? await video.path() : null
  if (!webmPath || !fs.existsSync(webmPath)) {
    console.error('✗ No video file produced.')
    process.exit(1)
  }

  console.log('  · transcoding to MP4…')
  execFileSync(
    'ffmpeg',
    ['-y', '-i', webmPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', mp4Path],
    { stdio: 'inherit' }
  )

  if (KEEP_WEBM) {
    const savedWebm = mp4Path.replace(/\.mp4$/, '.webm')
    fs.renameSync(webmPath, savedWebm)
    console.log(`  · kept raw webm: ${path.relative(process.cwd(), savedWebm)}`)
  } else {
    fs.rmSync(TMP_DIR, { recursive: true, force: true })
  }

  console.log(`✓ Saved ${path.relative(process.cwd(), mp4Path)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
