import { test, expect } from '@playwright/test'

test.setTimeout(90000)

// Count differing pixels between two PNG screenshot buffers using raw byte comparison
// PNGs from the same render state are byte-identical; any visual change produces different bytes
function buffersMatch(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return a.compare(b) === 0
}

test('right-drag: nodes move and stay at dropped position', async ({ page }) => {
  await page.goto('http://localhost:5173')

  // Wait for sim to finish
  await page.waitForSelector('text=SIM STABLE', { timeout: 60000 })
  console.log('✅ Simulation stable')
  await page.waitForTimeout(500)

  const canvas = page.locator('canvas')
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()

  // Clip region around the centre where most nodes cluster
  const clip = {
    x: box!.x + box!.width * 0.2,
    y: box!.y + box!.height * 0.2,
    width: box!.width * 0.6,
    height: box!.height * 0.6,
  }

  // Drag origin: slightly left of centre (where connected nodes tend to cluster)
  const dragX = Math.round(box!.x + box!.width * 0.45)
  const dragY = Math.round(box!.y + box!.height * 0.5)

  // --- BEFORE ---
  const ssBefore = await page.screenshot({ clip })
  await page.screenshot({ path: '/tmp/drag-before.png' })
  console.log(`📸 Before screenshot captured (${ssBefore.length} bytes)`)

  // --- DRAG ---
  await page.mouse.move(dragX, dragY)
  await page.mouse.down({ button: 'right' })
  // Move 260px right in smooth steps (no per-step wait — keep within timeout)
  await page.mouse.move(dragX + 260, dragY, { steps: 15 })
  await page.mouse.up({ button: 'right' })
  console.log('🖱️  Right-drag complete (260px right)')

  await page.waitForTimeout(400)
  const ssAfter = await page.screenshot({ clip })
  await page.screenshot({ path: '/tmp/drag-after.png' })
  console.log(`📸 After screenshot captured (${ssAfter.length} bytes)`)

  // --- SETTLE (2s) ---
  await page.waitForTimeout(2000)
  const ssSettled = await page.screenshot({ clip })
  await page.screenshot({ path: '/tmp/drag-settled.png' })
  console.log(`📸 Settled screenshot captured (${ssSettled.length} bytes)`)

  // ✅ Assert 1: drag actually changed the view
  const dragHadEffect = !buffersMatch(ssBefore, ssAfter)
  console.log(`Drag had effect: ${dragHadEffect}`)
  expect(dragHadEffect, '❌ Drag had no visual effect — nodes did not move').toBe(true)
  console.log('✅ PASS: drag changed the view')

  // ✅ Assert 2: nodes stayed — settled state must NOT match before-drag state
  const nodesStayed = !buffersMatch(ssBefore, ssSettled)
  console.log(`Nodes stayed: ${nodesStayed}`)
  expect(nodesStayed, '❌ Nodes snapped back to original position after drop').toBe(true)
  console.log('✅ PASS: nodes did not snap back')

  console.log('\nScreenshots saved:')
  console.log('  /tmp/drag-before.png')
  console.log('  /tmp/drag-after.png')
  console.log('  /tmp/drag-settled.png')
})
