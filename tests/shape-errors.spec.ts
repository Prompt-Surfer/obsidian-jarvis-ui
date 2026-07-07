import { test, expect } from '@playwright/test'

const BASE = process.env.JARVIS_TEST_URL || 'http://localhost:5173'

// Load a community shape by name via the flyout's input + LOAD button.
async function loadByName(page: import('@playwright/test').Page, name: string) {
  const trigger = page.locator('button[title*="Community cloud"]')
  if (!(await page.locator('input[placeholder*="filter"]').isVisible().catch(() => false))) {
    await trigger.click({ force: true })
  }
  const input = page.locator('input[placeholder*="filter"]')
  await input.fill(name, { force: true })
  await page.locator('button', { hasText: 'LOAD' }).click({ force: true })
}

test('BLACKHOLE.01 (NaN-zone formation) loads without error', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(BASE)
  await page.waitForSelector('canvas', { timeout: 30000 })
  await page.waitForTimeout(6000)

  await loadByName(page, 'https://particles.casberry.in/?sim=BLACKHOLE.01')
  await page.waitForTimeout(12000)

  // Success = the trigger shows the loaded shape and no error toast appeared
  await expect(page.locator('button[title*="Community cloud"]')).toContainText('BLACKHOLE.01')
  await expect(page.getByText('Shape failed', { exact: false })).toHaveCount(0)
  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([])
})

test('an unknown shape surfaces an error toast and reverts to natural', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(BASE)
  await page.waitForSelector('canvas', { timeout: 30000 })
  await page.waitForTimeout(6000)

  await loadByName(page, 'NO_SUCH_FORMATION_XYZ_12345')
  // Error toast appears; graph reverts to the natural layout
  await expect(page.getByText('Shape failed', { exact: false })).toBeVisible({ timeout: 15000 })
})
