import { test } from '@playwright/test'

test('Brain hierarchy: Version A (edge placement)', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('http://localhost:5173?brainMode=edge')

  await page.waitForSelector('canvas', { timeout: 30000 })
  await page.waitForTimeout(3000)

  // Select Brain shape
  await page.click('button[title="Brain"]', { force: true })
  await page.waitForTimeout(10000)

  await page.screenshot({ path: '/tmp/jarvis-brain-r3-versionA.png', fullPage: true })
})

test('Brain hierarchy: Version B (center placement)', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('http://localhost:5173?brainMode=center')

  await page.waitForSelector('canvas', { timeout: 30000 })
  await page.waitForTimeout(3000)

  // Select Brain shape
  await page.click('button[title="Brain"]', { force: true })
  await page.waitForTimeout(10000)

  await page.screenshot({ path: '/tmp/jarvis-brain-r3-versionB.png', fullPage: true })
})
