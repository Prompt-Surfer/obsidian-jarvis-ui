import { test, expect } from '@playwright/test'

const BASE = process.env.JARVIS_TEST_URL || 'http://localhost:5173'

test('load JARVIS MATRIX from community cloud via URL', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text())
  })

  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto(BASE)
  await page.waitForSelector('canvas', { timeout: 30000 })
  await page.waitForTimeout(6000)

  const input = page.locator('input[placeholder*="community"]')
  await input.fill('https://particles.casberry.in/?sim=JARVIS%2520MATRIX', { force: true })
  await page.locator('button', { hasText: 'LOAD' }).click({ force: true })

  // fetch + compile + morph
  await page.waitForTimeout(15000)
  await page.screenshot({ path: '/tmp/jarvis-matrix-shape.png' })

  // dropdown should now show the community shape as selected
  const dropdown = page.locator('select', { has: page.locator('option[value="imported:blackhole"]') })
  await expect(dropdown).toHaveValue('imported:casberry:JARVIS MATRIX')

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
