#!/usr/bin/env node
/**
 * Pixel diff comparison: iter5 screenshots vs baseline.
 * Reports similarity % for each shape mode.
 */

import { createCanvas, loadImage } from 'canvas'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const BASELINE_DIR = 'screenshots/baseline'
const ITER_DIR = 'screenshots/iter5'

const shapes = ['natural', 'milkyway', 'saturn', 'sun', 'brain']

async function compareScreenshots(shape) {
  const baselinePath = join(BASELINE_DIR, `${shape}.png`)
  const iterPath = join(ITER_DIR, `${shape}.png`)

  try {
    const [baseline, iter] = await Promise.all([
      loadImage(baselinePath),
      loadImage(iterPath),
    ])

    const w = Math.min(baseline.width, iter.width)
    const h = Math.min(baseline.height, iter.height)

    const canvas = createCanvas(w, h)
    const ctx = canvas.getContext('2d')

    ctx.drawImage(baseline, 0, 0)
    const baseData = ctx.getImageData(0, 0, w, h).data

    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(iter, 0, 0)
    const iterData = ctx.getImageData(0, 0, w, h).data

    let totalDiff = 0
    let pixelCount = w * h

    for (let i = 0; i < baseData.length; i += 4) {
      const dr = Math.abs(baseData[i] - iterData[i])
      const dg = Math.abs(baseData[i+1] - iterData[i+1])
      const db = Math.abs(baseData[i+2] - iterData[i+2])
      totalDiff += (dr + dg + db) / (3 * 255)
    }

    const diffRatio = totalDiff / pixelCount
    const similarity = 1 - diffRatio

    return { shape, similarity: Math.round(similarity * 1000) / 10, diffRatio: Math.round(diffRatio * 1000) / 1000 }
  } catch (e) {
    return { shape, error: e.message }
  }
}

const results = await Promise.all(shapes.map(compareScreenshots))
console.log('\nPixel diff results (iter5 vs baseline):')
for (const r of results) {
  if (r.error) {
    console.log(`  ${r.shape}: ERROR - ${r.error}`)
  } else {
    const status = r.similarity >= 70 ? '✓' : '⚠'
    console.log(`  ${status} ${r.shape}: ${r.similarity}% similar (diff ratio: ${r.diffRatio})`)
  }
}
