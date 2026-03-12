import { test, expect, Page } from '@playwright/test'

test.setTimeout(120000)

async function waitForGraphReady(page: Page) {
  await page.waitForSelector('canvas', { timeout: 30000 })
  try {
    await page.waitForSelector('text=SIM STABLE', { timeout: 45000 })
  } catch {
    await page.waitForTimeout(5000)
  }
  await page.waitForTimeout(1000)
}

async function findButton(page: Page, text: string) {
  const buttons = page.locator('button')
  const count = await buttons.count()
  for (let i = 0; i < count; i++) {
    const t = await buttons.nth(i).textContent()
    if (t?.trim() === text) return buttons.nth(i)
  }
  return null
}

async function getVisibleCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const els = document.querySelectorAll('*')
    for (const el of els) {
      const t = el.textContent || ''
      const m = t.match(/VISIBLE:\s*(\d+)/)
      if (m) return parseInt(m[1], 10)
    }
    return -1
  })
}

async function getHUDText(page: Page): Promise<string> {
  return page.evaluate(() => {
    // Top-left HUD block
    const divs = document.querySelectorAll('[style*="position: fixed"][style*="top"]')
    for (const d of divs) {
      if (d.textContent?.includes('NODES')) return d.textContent || ''
    }
    return ''
  })
}

async function getDateLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const panels = document.querySelectorAll('[style*="position: fixed"][style*="bottom"]')
    const labels: string[] = []
    for (const p of panels) {
      p.querySelectorAll('span').forEach(s => {
        const t = s.textContent?.trim()
        if (t && t.match(/[A-Z][a-z]{2}\s+\d+/)) labels.push(t)
      })
    }
    return labels
  })
}

async function isTimelapseIndicatorVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const els = document.querySelectorAll('*')
    for (const el of els) {
      if (el.textContent?.includes('TIMELAPSE')) return true
    }
    return false
  })
}

// ─────────────────────────────────────────────────────────────────

test.describe('Timelapse Feature (v2.6.0)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await waitForGraphReady(page)
  })

  test('playback controls are rendered (⏮, ▶, 1×, 5×, 20×)', async ({ page }) => {
    const reset = await findButton(page, '⏮')
    const play = await findButton(page, '▶')
    const s1 = await findButton(page, '1×')
    const s5 = await findButton(page, '5×')
    const s20 = await findButton(page, '20×')

    expect(reset, '⏮ reset button').toBeTruthy()
    expect(play, '▶ play button').toBeTruthy()
    expect(s1, '1× speed button').toBeTruthy()
    expect(s5, '5× speed button').toBeTruthy()
    expect(s20, '20× speed button').toBeTruthy()
    console.log('✅ All playback controls rendered')
  })

  test('play button toggles to pause icon', async ({ page }) => {
    // Initially shows ▶
    let play = await findButton(page, '▶')
    expect(play).toBeTruthy()

    // Click play — but first reset so we're not already at max
    const reset = await findButton(page, '⏮')
    await reset!.click()
    await page.waitForTimeout(300)

    play = await findButton(page, '▶')
    await play!.click()
    await page.waitForTimeout(300)

    // Should now show ⏸
    const pause = await findButton(page, '⏸')
    expect(pause, 'Pause button should appear after play').toBeTruthy()

    // Click pause
    await pause!.click()
    await page.waitForTimeout(300)

    // Should be back to ▶
    play = await findButton(page, '▶')
    expect(play, 'Play button should re-appear after pause').toBeTruthy()
    console.log('✅ Play/Pause toggle works correctly')
  })

  test('⏮ reset rewinds to start and pauses', async ({ page }) => {
    const reset = await findButton(page, '⏮')
    await reset!.click()
    await page.waitForTimeout(500)

    // After reset, visible count should be very low (only notes at earliest date)
    const vis = await getVisibleCount(page)
    console.log(`After reset: VISIBLE=${vis}`)
    // Should be much less than the full 946
    expect(vis).toBeLessThan(946)
    expect(vis).toBeGreaterThanOrEqual(0)

    // Play button should be ▶ (paused)
    const play = await findButton(page, '▶')
    expect(play, 'Should be paused after reset').toBeTruthy()
    console.log(`✅ Reset works: VISIBLE=${vis}, paused`)
  })

  test('playing from reset advances the timeline and adds nodes', async ({ page }) => {
    // Reset to start
    const reset = await findButton(page, '⏮')
    await reset!.click()
    await page.waitForTimeout(500)

    const visBefore = await getVisibleCount(page)
    const labelsBefore = await getDateLabels(page)
    console.log(`Before play: VISIBLE=${visBefore}, dates=${JSON.stringify(labelsBefore)}`)

    // Set to fastest speed for quick test
    const s20 = await findButton(page, '20×')
    await s20!.click()
    await page.waitForTimeout(200)

    // Hit play
    const play = await findButton(page, '▶')
    await play!.click()

    // Let it run for 3 seconds
    await page.waitForTimeout(3000)

    // Pause
    const pause = await findButton(page, '⏸')
    if (pause) await pause.click()
    await page.waitForTimeout(300)

    const visAfter = await getVisibleCount(page)
    const labelsAfter = await getDateLabels(page)
    console.log(`After 3s play: VISIBLE=${visAfter}, dates=${JSON.stringify(labelsAfter)}`)

    // Node count should have increased
    expect(visAfter).toBeGreaterThan(visBefore)
    console.log(`✅ Timeline advanced: ${visBefore} → ${visAfter} nodes`)
  })

  test('HUD shows TIMELAPSE indicator during playback', async ({ page }) => {
    // Reset and play
    const reset = await findButton(page, '⏮')
    await reset!.click()
    await page.waitForTimeout(300)

    const play = await findButton(page, '▶')
    await play!.click()
    await page.waitForTimeout(500)

    const visible = await isTimelapseIndicatorVisible(page)
    expect(visible, 'TIMELAPSE indicator should be visible during playback').toBe(true)
    console.log('✅ TIMELAPSE HUD indicator visible during playback')

    // Pause and check indicator disappears
    const pause = await findButton(page, '⏸')
    if (pause) await pause.click()
    await page.waitForTimeout(500)

    const hidden = await isTimelapseIndicatorVisible(page)
    expect(hidden, 'TIMELAPSE indicator should disappear when paused').toBe(false)
    console.log('✅ TIMELAPSE HUD indicator hidden when paused')
  })

  test('speed buttons change playback rate', async ({ page }) => {
    // Reset
    const reset = await findButton(page, '⏮')
    await reset!.click()
    await page.waitForTimeout(300)

    // Play at 1× for 2s
    const s1 = await findButton(page, '1×')
    await s1!.click()
    const play1 = await findButton(page, '▶')
    await play1!.click()
    await page.waitForTimeout(2000)
    const pause1 = await findButton(page, '⏸')
    if (pause1) await pause1.click()
    await page.waitForTimeout(200)
    const vis1x = await getVisibleCount(page)

    // Reset again
    await reset!.click()
    await page.waitForTimeout(300)

    // Play at 20× for 2s
    const s20 = await findButton(page, '20×')
    await s20!.click()
    const play2 = await findButton(page, '▶')
    await play2!.click()
    await page.waitForTimeout(2000)
    const pause2 = await findButton(page, '⏸')
    if (pause2) await pause2.click()
    await page.waitForTimeout(200)
    const vis20x = await getVisibleCount(page)

    console.log(`1× for 2s: ${vis1x} nodes | 20× for 2s: ${vis20x} nodes`)
    // 20× should advance much more than 1×
    expect(vis20x).toBeGreaterThan(vis1x)
    console.log(`✅ Speed difference confirmed: 20× (${vis20x}) > 1× (${vis1x})`)
  })

  test('playback stops automatically at end of timeline', async ({ page }) => {
    // Don't reset — start at full range (already at max)
    // Set ALL first so we're at the end
    const allBtn = await findButton(page, 'ALL')
    await allBtn!.click()
    await page.waitForTimeout(300)

    // Hit play (should immediately stop since we're at maxTs)
    const play = await findButton(page, '▶')
    await play!.click()
    await page.waitForTimeout(500)

    // Should auto-pause since range[1] >= maxTs
    const playAgain = await findButton(page, '▶')
    expect(playAgain, 'Should auto-pause when timeline reaches end').toBeTruthy()
    console.log('✅ Playback auto-stops at end of timeline')
  })

  test('visual diff: graph looks different after playing from reset', async ({ page }) => {
    // Reset
    const reset = await findButton(page, '⏮')
    await reset!.click()
    await page.waitForTimeout(500)
    const ssBefore = await page.screenshot()
    await page.screenshot({ path: '/tmp/timelapse-before.png' })

    // Play at max speed for 3s
    const s20 = await findButton(page, '20×')
    await s20!.click()
    const play = await findButton(page, '▶')
    await play!.click()
    await page.waitForTimeout(3000)
    const pause = await findButton(page, '⏸')
    if (pause) await pause.click()
    await page.waitForTimeout(500)

    const ssAfter = await page.screenshot()
    await page.screenshot({ path: '/tmp/timelapse-after.png' })

    const match = ssBefore.compare(ssAfter) === 0
    expect(match, 'Graph should look different after timelapse advances').toBe(false)
    console.log('✅ Visual difference confirmed: before vs after timelapse')
    console.log('   Screenshots: /tmp/timelapse-before.png, /tmp/timelapse-after.png')
  })

  test('no console errors during full timelapse play-through', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', err => errors.push(err.message))
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    // Reset + play at 20× — let it run until auto-stop or 10s
    const reset = await findButton(page, '⏮')
    await reset!.click()
    await page.waitForTimeout(300)

    const s20 = await findButton(page, '20×')
    await s20!.click()

    const play = await findButton(page, '▶')
    await play!.click()

    // Wait up to 10s for it to finish or just let it run
    await page.waitForTimeout(10000)

    // Pause if still going
    const pause = await findButton(page, '⏸')
    if (pause) await pause.click()

    const realErrors = errors.filter(e =>
      !e.includes('WebGPU') &&
      !e.includes('WebGL') &&
      !e.includes('THREE') &&
      !e.includes('GPU')
    )

    expect(realErrors.length, `Console errors: ${realErrors.join('; ')}`).toBe(0)
    console.log(`✅ No errors during timelapse (${errors.length} WebGL/GPU warnings filtered)`)
  })
})
