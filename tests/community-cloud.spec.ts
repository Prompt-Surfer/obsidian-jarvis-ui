import { test, expect } from '@playwright/test'

const BASE = process.env.JARVIS_TEST_URL || 'http://localhost:5173'

test('community flyout menu: pinned JARVIS MATRIX + live motion', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text())
  })

  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto(BASE)
  await page.waitForSelector('canvas', { timeout: 30000 })
  await page.waitForTimeout(6000)

  // Open the community dropdown — flyout should appear right of the panel
  const trigger = page.locator('button[title*="Community cloud"]')
  await trigger.click({ force: true })
  const menuItem = page.locator('button', { hasText: 'JARVIS MATRIX' }).last()
  await expect(menuItem).toBeVisible()
  await page.screenshot({ path: '/tmp/jarvis-community-flyout.png' })

  // Top pinned option loads the shape
  await menuItem.click()
  await page.waitForTimeout(15000)
  await page.screenshot({ path: '/tmp/jarvis-matrix-flyout-loaded.png' })
  await expect(trigger).toContainText('JARVIS MATRIX')

  // Live motion + auto-rotate: the frame must keep changing over time
  const a = await page.locator('canvas').first().screenshot()
  await page.waitForTimeout(3000)
  const b = await page.locator('canvas').first().screenshot()
  expect(a.equals(b), 'canvas should animate (shape motion / auto-rotate)').toBe(false)

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
