import { test } from '@playwright/test'

test('Milky Way shape screenshot', async ({ page }) => {
  // Use a larger viewport so settings panel is fully visible
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('http://localhost:5173')

  // Wait for canvas (graph rendered)
  await page.waitForSelector('canvas', { timeout: 15000 })
  await page.waitForTimeout(3000)

  // Settings panel starts open by default. Click Milky Way button.
  const milkyWayBtn = page.locator('button[title="Milky Way"]')
  const count = await milkyWayBtn.count()

  if (count === 0) {
    await page.click('button:has-text("⚙")')
    await page.waitForTimeout(500)
  }

  await page.click('button[title="Milky Way"]', { force: true })

  // Wait for simulation to settle
  await page.waitForTimeout(4000)

  // Take screenshot
  await page.screenshot({ path: '/tmp/jarvis-milkyway-screenshot.png', fullPage: true })
})
