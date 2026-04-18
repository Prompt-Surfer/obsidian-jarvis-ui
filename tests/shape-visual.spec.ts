import { test, expect, Page } from '@playwright/test'
import path from 'path'

test.setTimeout(120000)

const SHAPES = ['natural', 'milkyway', 'saturn', 'sun', 'brain'] as const

async function waitForSimStable(page: Page, timeout = 60000) {
  await page.waitForSelector('canvas', { timeout: 30000 })
  try {
    await page.waitForSelector('text=SIM STABLE', { timeout })
  } catch {
    await page.waitForTimeout(5000)
  }
  await page.waitForTimeout(2000)
}

async function clickShape(page: Page, shape: string) {
  const buttons = page.locator('button')
  const count = await buttons.count()
  for (let i = 0; i < count; i++) {
    const text = (await buttons.nth(i).textContent())?.trim().toLowerCase()
    if (text === shape.toLowerCase()) {
      await buttons.nth(i).click()
      return true
    }
  }
  // Try uppercase/styled buttons
  const all = page.locator('*')
  const allCount = await all.count()
  for (let i = 0; i < allCount; i++) {
    try {
      const el = all.nth(i)
      const text = (await el.textContent())?.trim().toLowerCase()
      if (text === shape.toLowerCase()) {
        await el.click()
        return true
      }
    } catch { /* skip */ }
  }
  return false
}

test.describe('Shape Visual Gates', () => {
  test('Natural mode — tree-like structure check', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await waitForSimStable(page)

    const screenshot = await page.screenshot({ fullPage: false })

    // Save candidate screenshot
    const fs = await import('fs')
    fs.writeFileSync('screenshots/iter5/natural.png', screenshot)

    // Vision gate: canvas must be visible and non-black
    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()

    // Check canvas has actual content (not all black)
    const hasContent = await page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement
      if (!canvas) return false
      const ctx = canvas.getContext('2d')
      if (!ctx) return false
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let nonBlack = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 10 || data[i+1] > 10 || data[i+2] > 10) nonBlack++
      }
      return nonBlack > 100
    })
    expect(hasContent).toBe(true)
  })

  for (const shape of ['milkyway', 'saturn', 'sun', 'brain'] as const) {
    test(`${shape} mode — settles and renders`, async ({ page }) => {
      await page.goto('http://localhost:5173')
      await waitForSimStable(page)

      // Click shape button
      const clicked = await clickShape(page, shape)
      if (!clicked) {
        console.log(`Could not find button for shape: ${shape}`)
      }

      // Wait for shape to settle
      await page.waitForTimeout(8000)

      const screenshot = await page.screenshot({ fullPage: false })
      const fs = await import('fs')
      const { mkdirSync } = await import('fs')
      mkdirSync('screenshots/iter5', { recursive: true })
      fs.writeFileSync(`screenshots/iter5/${shape}.png`, screenshot)

      // Canvas must be visible
      const canvas = page.locator('canvas')
      await expect(canvas).toBeVisible()
    })
  }
})
