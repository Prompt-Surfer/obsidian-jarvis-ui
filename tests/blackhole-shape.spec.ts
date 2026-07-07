import { test, expect } from '@playwright/test'

const BASE = process.env.JARVIS_TEST_URL || 'http://localhost:5173'

test('imported Black Hole shape via dropdown', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text())
  })

  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto(BASE)

  await page.waitForSelector('canvas', { timeout: 30000 })
  await page.waitForTimeout(6000)
  await page.screenshot({ path: '/tmp/jarvis-blackhole-before.png' })

  // BLACKHOLE loads via the community pipeline like every other formation;
  // the pinned entry renders first in the flyout
  const trigger = page.locator('button[title*="Community cloud"]')
  await trigger.click({ force: true })
  await page.locator('button', { hasText: 'BLACKHOLE' }).first().click()
  await expect(trigger).toContainText('BLACKHOLE')

  // Wait for the swarm to morph into the shape
  await page.waitForTimeout(12000)
  await page.screenshot({ path: '/tmp/jarvis-blackhole-after.png' })

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
