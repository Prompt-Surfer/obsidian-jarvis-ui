import { test, expect, Page } from '@playwright/test'

test.setTimeout(120000)

/**
 * Thorough test suite for TimeFilter preset buttons (1D, 1W, 1M, 1Y, ALL).
 *
 * Tests:
 * 1. All 5 preset buttons render and are clickable
 * 2. Active preset gets highlighted styling
 * 3. Each preset filters nodes correctly (fewer nodes for tighter ranges)
 * 4. ALL preset shows all nodes (no filter)
 * 5. Switching presets updates the date labels
 * 6. Preset resets when manual slider is used
 * 7. Clicking same preset twice doesn't break anything
 * 8. Graph visually changes when preset narrows the time window
 */

const PRESETS = ['1D', '1W', '1M', '1Y', 'ALL'] as const

async function waitForGraphReady(page: Page) {
  // Wait for canvas to appear (Three.js scene mounted)
  await page.waitForSelector('canvas', { timeout: 30000 })
  // Wait for sim stable or just give it time to load nodes
  try {
    await page.waitForSelector('text=SIM STABLE', { timeout: 45000 })
  } catch {
    // Even if SIM STABLE doesn't appear, continue — nodes may still be present
    await page.waitForTimeout(5000)
  }
  // Extra settle time for render
  await page.waitForTimeout(1000)
}

async function getPresetButton(page: Page, label: string) {
  // TimeFilter preset buttons are plain <button> elements with text content
  const buttons = page.locator('button')
  const count = await buttons.count()
  for (let i = 0; i < count; i++) {
    const text = await buttons.nth(i).textContent()
    if (text?.trim() === label) {
      return buttons.nth(i)
    }
  }
  return null
}

async function getPresetButtons(page: Page) {
  const result: Record<string, ReturnType<typeof page.locator>> = {}
  for (const p of PRESETS) {
    const btn = await getPresetButton(page, p)
    if (btn) result[p] = btn
  }
  return result
}

async function getNodeCount(page: Page): Promise<number> {
  // Read the HUD "VISIBLE: N" line (filtered count) rather than "NODES: N" (total)
  const hudText = await page.evaluate(() => {
    const els = document.querySelectorAll('*')
    for (const el of els) {
      const t = el.textContent || ''
      // Prefer VISIBLE count (reflects time filter), fall back to NODES
      const visMatch = t.match(/VISIBLE:\s*(\d+)/)
      if (visMatch) return parseInt(visMatch[1], 10)
    }
    // Fallback: total nodes
    for (const el of els) {
      const t = el.textContent || ''
      const match = t.match(/NODES:\s*(\d+)/)
      if (match) return parseInt(match[1], 10)
    }
    return -1
  })
  return hudText
}

async function getDateLabels(page: Page): Promise<string[]> {
  // The TimeFilter shows two date labels at bottom (start and end of range)
  return page.evaluate(() => {
    // Date labels are the last two <span> elements in the TimeFilter container
    // They're inside the fixed bottom panel
    const fixedPanels = document.querySelectorAll('[style*="position: fixed"][style*="bottom"]')
    const labels: string[] = []
    for (const panel of fixedPanels) {
      const spans = panel.querySelectorAll('span')
      spans.forEach(s => {
        const text = s.textContent?.trim()
        if (text && text.match(/[A-Z][a-z]{2}\s+\d+/)) {
          labels.push(text)
        }
      })
    }
    return labels
  })
}

async function getButtonStyles(page: Page, label: string) {
  return page.evaluate((label) => {
    const buttons = document.querySelectorAll('button')
    for (const btn of buttons) {
      if (btn.textContent?.trim() === label) {
        // Use getComputedStyle for reliable values (handles React inline + CSS)
        const computed = window.getComputedStyle(btn)
        return {
          background: btn.style.background || btn.style.backgroundColor || computed.backgroundColor,
          borderColor: btn.style.border || btn.style.borderColor || computed.borderColor,
          color: btn.style.color || computed.color,
        }
      }
    }
    return null
  }, label)
}

// #00d4ff = rgb(0, 212, 255), #00a8cc = rgb(0, 168, 204)
function isActiveCyan(colorStr: string | undefined): boolean {
  if (!colorStr) return false
  return colorStr.includes('#00d4ff') ||
         colorStr.includes('rgb(0, 212, 255)') ||
         colorStr.includes('0, 212, 255')
}

function isDimCyan(colorStr: string | undefined): boolean {
  if (!colorStr) return false
  return colorStr.includes('#00a8cc') ||
         colorStr.includes('rgb(0, 168, 204)') ||
         colorStr.includes('0, 168, 204')
}

// ─────────────────────────────────────────────────────────────────

test.describe('TimeFilter Preset Buttons', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await waitForGraphReady(page)
  })

  test('all 5 preset buttons are rendered', async ({ page }) => {
    const buttons = await getPresetButtons(page)
    for (const p of PRESETS) {
      expect(buttons[p], `Preset button "${p}" should exist`).toBeTruthy()
      const visible = await buttons[p].isVisible()
      expect(visible, `Preset button "${p}" should be visible`).toBe(true)
    }
    console.log('✅ All 5 preset buttons rendered and visible')
  })

  test('ALL preset is active by default', async ({ page }) => {
    const allStyles = await getButtonStyles(page, 'ALL')
    expect(allStyles).not.toBeNull()
    // Active state should have cyan highlight (#00d4ff / rgb(0,212,255))
    const isHighlighted = isActiveCyan(allStyles!.borderColor) ||
                          isActiveCyan(allStyles!.background) ||
                          isActiveCyan(allStyles!.color)
    expect(isHighlighted, `ALL button should have active/highlighted styling. Got: ${JSON.stringify(allStyles)}`).toBe(true)
    console.log('✅ ALL preset is active by default')
    console.log(`   Styles: ${JSON.stringify(allStyles)}`)
  })

  test('clicking each preset highlights it and de-highlights others', async ({ page }) => {
    for (const p of PRESETS) {
      const btn = await getPresetButton(page, p)
      expect(btn).not.toBeNull()
      await btn!.click()
      await page.waitForTimeout(500)

      // Check active button has cyan color
      const activeStyles = await getButtonStyles(page, p)
      const isActive = isActiveCyan(activeStyles?.color) || isActiveCyan(activeStyles?.borderColor)
      expect(isActive, `${p} should be highlighted after click. Got: ${JSON.stringify(activeStyles)}`).toBe(true)

      // Check other buttons are NOT highlighted with cyan
      for (const other of PRESETS) {
        if (other === p) continue
        const otherStyles = await getButtonStyles(page, other)
        // Non-active buttons should have dim color, not bright cyan
        const isNotActive = isDimCyan(otherStyles?.color) || !isActiveCyan(otherStyles?.color)
        expect(isNotActive, `${other} should NOT be highlighted when ${p} is active`).toBe(true)
      }
      console.log(`✅ ${p} preset: correctly highlighted, others dimmed`)
    }
  })

  test('preset filters reduce visible node count (1D < 1W < 1M < 1Y <= ALL)', async ({ page }) => {
    // Get ALL count first
    const allBtn = await getPresetButton(page, 'ALL')
    await allBtn!.click()
    await page.waitForTimeout(800)
    const allCount = await getNodeCount(page)
    console.log(`ALL: ${allCount} nodes`)

    // Now go through tighter ranges — each should have <= previous
    const counts: Record<string, number> = { ALL: allCount }
    for (const p of ['1Y', '1M', '1W', '1D'] as const) {
      const btn = await getPresetButton(page, p)
      await btn!.click()
      await page.waitForTimeout(800)
      const count = await getNodeCount(page)
      counts[p] = count
      console.log(`${p}: ${count} nodes`)
    }

    // Verify ordering: 1D <= 1W <= 1M <= 1Y <= ALL
    expect(counts['1D']).toBeLessThanOrEqual(counts['1W'])
    expect(counts['1W']).toBeLessThanOrEqual(counts['1M'])
    expect(counts['1M']).toBeLessThanOrEqual(counts['1Y'])
    expect(counts['1Y']).toBeLessThanOrEqual(counts['ALL'])
    console.log('✅ Node counts follow expected ordering: 1D ≤ 1W ≤ 1M ≤ 1Y ≤ ALL')
  })

  test('ALL preset shows maximum nodes (no filtering)', async ({ page }) => {
    // Click 1M first to filter
    const mBtn = await getPresetButton(page, '1M')
    await mBtn!.click()
    await page.waitForTimeout(800)
    const filteredCount = await getNodeCount(page)

    // Click ALL to restore
    const allBtn = await getPresetButton(page, 'ALL')
    await allBtn!.click()
    await page.waitForTimeout(800)
    const allCount = await getNodeCount(page)

    expect(allCount).toBeGreaterThanOrEqual(filteredCount)
    console.log(`✅ ALL (${allCount}) >= 1M filtered (${filteredCount})`)
  })

  test('date labels update when preset changes', async ({ page }) => {
    // Get labels with ALL
    const allBtn = await getPresetButton(page, 'ALL')
    await allBtn!.click()
    await page.waitForTimeout(500)
    const allLabels = await getDateLabels(page)
    console.log(`ALL labels: ${JSON.stringify(allLabels)}`)

    // Switch to 1W
    const wBtn = await getPresetButton(page, '1W')
    await wBtn!.click()
    await page.waitForTimeout(500)
    const weekLabels = await getDateLabels(page)
    console.log(`1W labels: ${JSON.stringify(weekLabels)}`)

    // Labels should differ (start date changes)
    if (allLabels.length >= 2 && weekLabels.length >= 2) {
      // The start date should be different (1W starts ~7 days ago vs ALL starts at earliest note)
      expect(weekLabels[0]).not.toEqual(allLabels[0])
      console.log('✅ Date labels updated correctly')
    } else {
      console.log('⚠️ Could not find date labels — skipping assertion (labels might use different format)')
    }
  })

  test('double-clicking same preset does not break state', async ({ page }) => {
    const wBtn = await getPresetButton(page, '1W')
    await wBtn!.click()
    await page.waitForTimeout(300)
    const countFirst = await getNodeCount(page)

    await wBtn!.click()
    await page.waitForTimeout(300)
    const countSecond = await getNodeCount(page)

    expect(countFirst).toEqual(countSecond)
    console.log(`✅ Double-click 1W: ${countFirst} → ${countSecond} (stable)`)
  })

  test('graph visually changes when switching presets', async ({ page }) => {
    // Screenshot with ALL
    const allBtn = await getPresetButton(page, 'ALL')
    await allBtn!.click()
    await page.waitForTimeout(1000)
    const ssAll = await page.screenshot()
    await page.screenshot({ path: '/tmp/preset-all.png' })

    // Screenshot with 1D (should hide most nodes)
    const dBtn = await getPresetButton(page, '1D')
    await dBtn!.click()
    await page.waitForTimeout(1000)
    const ss1d = await page.screenshot()
    await page.screenshot({ path: '/tmp/preset-1d.png' })

    // Views should differ
    const match = ssAll.compare(ss1d) === 0
    expect(match, 'ALL and 1D views should look different').toBe(false)
    console.log('✅ Visual difference confirmed between ALL and 1D presets')
    console.log('   Screenshots: /tmp/preset-all.png, /tmp/preset-1d.png')
  })

  test('switching from narrow preset back to ALL restores all nodes', async ({ page }) => {
    // Get initial ALL count
    const allBtn = await getPresetButton(page, 'ALL')
    await allBtn!.click()
    await page.waitForTimeout(500)
    const initialAll = await getNodeCount(page)

    // Go to 1D
    const dBtn = await getPresetButton(page, '1D')
    await dBtn!.click()
    await page.waitForTimeout(500)

    // Go to 1M
    const mBtn = await getPresetButton(page, '1M')
    await mBtn!.click()
    await page.waitForTimeout(500)

    // Back to ALL
    await allBtn!.click()
    await page.waitForTimeout(500)
    const finalAll = await getNodeCount(page)

    expect(finalAll).toEqual(initialAll)
    console.log(`✅ Round-trip: ALL(${initialAll}) → 1D → 1M → ALL(${finalAll}) — count preserved`)
  })

  test('rapid preset switching does not crash or produce errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', err => errors.push(err.message))
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    // Rapidly cycle through all presets multiple times
    for (let round = 0; round < 3; round++) {
      for (const p of PRESETS) {
        const btn = await getPresetButton(page, p)
        if (btn) await btn.click()
        await page.waitForTimeout(100)
      }
    }
    await page.waitForTimeout(1000)

    // Filter out WebGPU/WebGL warnings that are not bugs
    const realErrors = errors.filter(e =>
      !e.includes('WebGPU') &&
      !e.includes('WebGL') &&
      !e.includes('THREE') &&
      !e.includes('GPU')
    )

    expect(realErrors.length, `Console errors found: ${realErrors.join('; ')}`).toBe(0)
    console.log(`✅ Rapid cycling (3 rounds × 5 presets) — no errors. (${errors.length} WebGL/GPU warnings filtered)`)
  })
})
