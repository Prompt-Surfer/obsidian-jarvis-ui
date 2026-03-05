import { test } from '@playwright/test'

test('Milky Way + Saturn shape screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('http://localhost:5173')

  // Wait for canvas (graph rendered)
  await page.waitForSelector('canvas', { timeout: 30000 })
  await page.waitForTimeout(3000)

  // --- Milky Way screenshot ---
  await page.click('button[title="Milky Way"]', { force: true })
  await page.waitForTimeout(8000)
  await page.screenshot({ path: '/tmp/jarvis-milkyway-final.png', fullPage: true })

  // --- Saturn screenshot ---
  await page.click('button[title="Saturn"]', { force: true })
  await page.waitForTimeout(8000)
  await page.screenshot({ path: '/tmp/jarvis-saturn-final.png', fullPage: true })

  // --- Brain screenshot ---
  await page.click('button[title="Brain"]', { force: true })
  await page.waitForTimeout(8000)
  await page.screenshot({ path: '/tmp/jarvis-brain-final.png', fullPage: true })
})
