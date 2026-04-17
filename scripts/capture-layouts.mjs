#!/usr/bin/env node
// Playwright script: capture all layout preset screenshots + measure wall-clock settle time
// Usage: node scripts/capture-layouts.mjs [output-dir]

import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const outDir = process.argv[2] || 'screenshots/baseline'
mkdirSync(outDir, { recursive: true })

const PRESETS = [
  { value: 'natural',  label: 'Natural'   },
  { value: 'milkyway', label: 'Milky Way' },
  { value: 'saturn',   label: 'Saturn'    },
  { value: 'sun',      label: 'The Sun'   },
  { value: 'brain',    label: 'Brain'     },
]

;(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  // Log all console messages to see what we can capture
  page.on('console', msg => {
    if (msg.type() === 'debug' || msg.text().includes('perf')) {
      console.log(`[BROWSER ${msg.type()}] ${msg.text()}`)
    }
  })

  console.log('Navigating to http://localhost:5173 ...')
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('canvas', { timeout: 20000 })
  console.log('Canvas loaded, waiting 6s for initial settle...')
  await page.waitForTimeout(6000)

  // Wait for initial sim stable
  try {
    await page.waitForText('■ SIM STABLE', { timeout: 30000 })
    console.log('Initial sim stable')
  } catch {
    console.log('Sim stable timeout on initial load (continuing)')
  }

  const results = {}

  for (const preset of PRESETS) {
    console.log(`\n=== ${preset.label} ===`)

    const startWall = Date.now()

    // Click preset button
    await page.locator(`button:has-text("${preset.label}")`).first().click()

    // Brief pause for sim to start
    await page.waitForTimeout(500)

    // Wait for sim to go back to SIMULATING first (confirms it started)
    try {
      await page.waitForSelector('text=◌ SIMULATING', { timeout: 5000 })
      console.log('  Simulating started...')
    } catch {
      console.log('  Already stable or no SIMULATING text found')
    }

    // Now wait for SIM STABLE
    try {
      await page.waitForSelector('text=■ SIM STABLE', { timeout: 60000 })
      const settleMs = Date.now() - startWall
      console.log(`  ✓ SIM STABLE at ${settleMs}ms`)
      results[preset.value] = { settleMs, status: 'stable' }
    } catch {
      const settleMs = Date.now() - startWall
      console.log(`  ✗ SIM timeout after ${settleMs}ms`)
      results[preset.value] = { settleMs, status: 'timeout' }
    }

    // Extra wait for visual stability after sim done
    await page.waitForTimeout(2000)

    const screenshotPath = join(outDir, `${preset.value}.png`)
    await page.screenshot({ path: screenshotPath })
    console.log(`  Screenshot: ${screenshotPath}`)
  }

  await browser.close()

  console.log('\nRESULTS_JSON:' + JSON.stringify(results, null, 2))
})()
