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

  // Min-distance applies on the natural layout — enabled at startup
  await expect(page.getByText('MIN DISTANCE', { exact: false }).first()).not.toContainText('NATURAL ONLY')

  // Open the community dropdown — flyout should appear right of the panel
  const trigger = page.locator('button[title*="Community cloud"]')
  await trigger.click({ force: true })
  const menuItem = page.locator('button', { hasText: 'JARVIS MATRIX' }).first()
  await expect(menuItem).toBeVisible()

  // Starter favourites section on top; full catalog below (newest first)
  await expect(page.getByText('★ FAVOURITES')).toBeVisible()
  await expect(page.getByText('ALL FORMATIONS')).toBeVisible({ timeout: 20000 })
  const itemCount = await page.locator('button', { hasText: '☁️' }).count()
  expect(itemCount, 'full catalog should be listed').toBeGreaterThan(100)
  await page.screenshot({ path: '/tmp/jarvis-community-flyout.png' })

  // Top pinned option loads the shape — and the menu stays open
  await menuItem.click()
  await expect(page.getByText('ALL FORMATIONS')).toBeVisible()
  await page.waitForTimeout(15000)
  await page.screenshot({ path: '/tmp/jarvis-matrix-flyout-loaded.png' })
  await expect(trigger).toContainText('JARVIS MATRIX')

  // Community shapes default links to off (dense swarms bury link lines)
  await expect(page.locator('button', { hasText: 'LINKS OFF' })).toBeVisible()

  // Clicking the graph (canvas) closes the menu
  await page.locator('canvas').first().click({ position: { x: 300, y: 200 }, force: true })
  await expect(page.getByText('ALL FORMATIONS')).not.toBeVisible()

  // Min-distance doesn't apply to shape-driven layouts — greyed + disabled
  await expect(page.getByText('MIN DISTANCE · NATURAL ONLY')).toBeVisible()
  await expect(page.locator('div[aria-disabled="true"] input[type="range"]').first()).toBeVisible()

  // Live motion + auto-rotate: the frame must keep changing over time
  const a = await page.locator('canvas').first().screenshot()
  await page.waitForTimeout(3000)
  const b = await page.locator('canvas').first().screenshot()
  expect(a.equals(b), 'canvas should animate (shape motion / auto-rotate)').toBe(false)

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
