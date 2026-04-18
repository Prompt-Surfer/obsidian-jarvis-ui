#!/usr/bin/env node
/**
 * Force simulation benchmark for alphaDecay optimization
 * Binary search on alphaDecay range [0.01, 0.1] to achieve settling_tick < 100
 * Target baseline: settling_tick < 100 (vs current 163)
 */

import fs from 'fs'
import path from 'path'
import { Worker } from 'worker_threads'

// Synthetic Jarvis-like graph for benchmarking
interface BenchmarkNode {
  id: string
  folder: string
  tags?: string[]
}

interface BenchmarkLink {
  source: string
  target: string
}

interface BenchmarkResult {
  alphaDecay: number
  settlingTick: number
  layoutValid: boolean
  convergenceTime: number
  iteration: number
}

// Generate a synthetic Jarvis vault-like graph (mimics otacon-vault structure)
function generateSyntheticGraph(): { nodes: BenchmarkNode[]; links: BenchmarkLink[] } {
  const nodes: BenchmarkNode[] = []
  const links: BenchmarkLink[] = []

  // Create 150 nodes across 5 folders (mimics real vault structure)
  const folders = ['projects', 'research', 'personal', 'work', 'notes']
  const tags = ['important', 'archive', 'draft', 'review', 'published']

  for (let i = 0; i < 150; i++) {
    const folder = folders[i % folders.length]
    const nodeTags = [tags[Math.floor(Math.random() * tags.length)]]
    if (Math.random() > 0.7) nodeTags.push(tags[Math.floor(Math.random() * tags.length)])

    nodes.push({
      id: `node_${i}`,
      folder,
      tags: nodeTags,
    })
  }

  // Create ~200 links with realistic density
  for (let i = 0; i < 200; i++) {
    const source = `node_${Math.floor(Math.random() * nodes.length)}`
    const target = `node_${Math.floor(Math.random() * nodes.length)}`
    if (source !== target) {
      links.push({ source, target })
    }
  }

  return { nodes, links }
}

/**
 * Run a single force simulation benchmark with given alphaDecay
 */
function runBenchmark(
  alphaDecay: number,
  nodes: BenchmarkNode[],
  links: BenchmarkLink[],
  iteration: number,
): Promise<BenchmarkResult> {
  return new Promise((resolve, reject) => {
    const workerScript = path.join(
      __dirname,
      'src/workers/force3d.worker.ts'
    )

    let settlingTick = 0
    let layoutValid = true
    let resolved = false
    const startTime = performance.now()

    // Create a minimal wrapper for the worker
    // We need to extract the worker logic and run it in this process instead
    // For simplicity, we'll directly calculate settling ticks using d3-force-3d

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const d3Force = require('d3-force-3d')
      const { forceSimulation, forceLink, forceManyBody, forceCenter } = d3Force

      // Setup nodes with positions
      const simNodes = nodes.map((n) => ({
        id: n.id,
        folder: n.folder,
        tags: n.tags,
        x: (Math.random() - 0.5) * 400,
        y: (Math.random() - 0.5) * 400,
        z: (Math.random() - 0.5) * 400,
        vx: 0,
        vy: 0,
        vz: 0,
      }))

      const simLinks = links.map((l) => ({
        source: l.source,
        target: l.target,
      }))

      // Create simulation with current alphaDecay
      const simulation = forceSimulation(simNodes, 3)
        .force(
          'link',
          forceLink(simLinks)
            .id((d: any) => d.id)
            .distance(60)
            .strength(0.5),
        )
        .force('charge', forceManyBody().strength(-120))
        .force('center', forceCenter(0, 0, 0).strength(0.05))
        .alphaDecay(alphaDecay)
        .velocityDecay(0.4)
        .stop()

      const ALPHA_MIN = 0.001
      const MAX_TICKS = 200

      // Run simulation ticks until convergence
      for (let tick = 0; tick < MAX_TICKS; tick++) {
        simulation.tick()
        settlingTick = tick + 1

        // Check convergence
        if (simulation.alpha() < ALPHA_MIN) {
          settlingTick = tick + 1
          break
        }
      }

      // Check layout validity (no nodes exploded)
      const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }
      for (const node of simNodes) {
        bounds.minX = Math.min(bounds.minX, node.x)
        bounds.maxX = Math.max(bounds.maxX, node.x)
        bounds.minY = Math.min(bounds.minY, node.y)
        bounds.maxY = Math.max(bounds.maxY, node.y)
        bounds.minZ = Math.min(bounds.minZ, node.z)
        bounds.maxZ = Math.max(bounds.maxZ, node.z)
      }

      const diameterXY = Math.sqrt(
        Math.pow(bounds.maxX - bounds.minX, 2) + Math.pow(bounds.maxY - bounds.minY, 2),
      )
      // Safety gate: if diameter exceeds 2000, graph exploded
      layoutValid = diameterXY < 2000

      const convergenceTime = performance.now() - startTime

      if (!resolved) {
        resolved = true
        resolve({
          alphaDecay,
          settlingTick,
          layoutValid,
          convergenceTime,
          iteration,
        })
      }
    } catch (error) {
      if (!resolved) {
        resolved = true
        reject(error)
      }
    }
  })
}

/**
 * Binary search for optimal alphaDecay
 */
async function binarySearchOptimization(
  nodes: BenchmarkNode[],
  links: BenchmarkLink[],
  maxIterations: number = 5,
) {
  const results: BenchmarkResult[] = []
  let low = 0.01
  let high = 0.1
  let noImprovementCount = 0
  let bestSettlingTick = 163 // baseline
  let bestAlphaDecay = 0.02 // current value

  console.log('='.repeat(80))
  console.log('D3-FORCE-3D ALPHADECAY OPTIMIZATION')
  console.log('='.repeat(80))
  console.log(`Target: settling_tick < 100 (baseline: 163)`)
  console.log(`Range: alphaDecay ∈ [${low}, ${high}]`)
  console.log(`Max iterations: ${maxIterations}`)
  console.log(''.repeat(80))
  console.log('')

  for (let iter = 0; iter < maxIterations; iter++) {
    const mid = (low + high) / 2

    console.log(`[Iteration ${iter + 1}/${maxIterations}]`)
    console.log(`Testing alphaDecay = ${mid.toFixed(6)}`)
    console.log(`Current range: [${low.toFixed(6)}, ${high.toFixed(6)}]`)

    try {
      const result = await runBenchmark(mid, nodes, links, iter + 1)
      results.push(result)

      console.log(`  ✓ Settling tick: ${result.settlingTick}`)
      console.log(`  ✓ Layout valid: ${result.layoutValid ? '✓ YES' : '✗ NO (EXPLODED)'}`)
      console.log(`  ✓ Convergence time: ${result.convergenceTime.toFixed(2)}ms`)
      console.log('')

      // Check improvement
      const improvementDelta = bestSettlingTick - result.settlingTick
      if (improvementDelta > 0) {
        bestSettlingTick = result.settlingTick
        bestAlphaDecay = mid
        noImprovementCount = 0
        console.log(`  ↑ IMPROVEMENT: settling_tick reduced by ${improvementDelta} ticks`)
      } else {
        noImprovementCount++
        console.log(`  → No improvement (stall count: ${noImprovementCount})`)
      }

      // Safety gate: if layout exploded, skip this region
      if (!result.layoutValid) {
        console.log(`  ⚠ Layout exploded! Narrowing search range.`)
        high = mid // Reduce search space
      } else if (result.settlingTick < 100) {
        // Target achieved, can explore lower alphaDecay (faster decay)
        console.log(`  ✅ TARGET ACHIEVED! Exploring for even faster convergence...`)
        low = mid * 0.95
        high = mid
      } else {
        // Not yet achieved, increase alphaDecay (slower decay)
        low = mid
      }

      // Early exit if no improvement for 2 consecutive iterations
      if (noImprovementCount >= 2) {
        console.log(`\n⊘ STALL DETECTED: No improvement for 2 consecutive iterations. Stopping search.`)
        break
      }

      console.log(''.repeat(80))
    } catch (error) {
      console.error(`Error in iteration ${iter + 1}:`, error)
      console.log('')
    }
  }

  // Print summary
  console.log('='.repeat(80))
  console.log('FINAL RESULTS')
  console.log('='.repeat(80))
  console.log(`Baseline:              settling_tick = 163`)
  console.log(`Best configuration:    alphaDecay = ${bestAlphaDecay.toFixed(6)}`)
  console.log(`Best settling_tick:    ${bestSettlingTick}`)
  console.log(`Improvement:           ${163 - bestSettlingTick} ticks (${((163 - bestSettlingTick) / 163 * 100).toFixed(1)}%)`)
  console.log(`Target achieved:       ${bestSettlingTick < 100 ? '✓ YES' : '✗ NO'}`)
  console.log(''.repeat(80))
  console.log('')
  console.log('ITERATION LOG:')
  console.log('-'.repeat(80))
  console.table(
    results.map((r) => ({
      Iteration: r.iteration,
      alphaDecay: r.alphaDecay.toFixed(6),
      settling_tick: r.settlingTick,
      layout_valid: r.layoutValid ? 'YES' : 'NO',
      convergence_ms: r.convergenceTime.toFixed(2),
    })),
  )
  console.log('-'.repeat(80))
  console.log('')

  if (bestSettlingTick < 100) {
    console.log(`✅ SUCCESS: Achieved target settling_tick < 100 with alphaDecay = ${bestAlphaDecay.toFixed(6)}`)
  } else {
    console.log(`⚠ WARNING: Target not reached. Best: settling_tick = ${bestSettlingTick} (target: < 100)`)
  }

  return {
    bestAlphaDecay,
    bestSettlingTick,
    results,
    targetAchieved: bestSettlingTick < 100,
  }
}

/**
 * Main entry point
 */
async function main() {
  try {
    console.log('Generating synthetic Jarvis vault graph...')
    const { nodes, links } = generateSyntheticGraph()
    console.log(`  Nodes: ${nodes.length}`)
    console.log(`  Links: ${links.length}`)
    console.log('')

    const optimizationResult = await binarySearchOptimization(nodes, links, 5)

    // Return exit code based on target achievement
    process.exit(optimizationResult.targetAchieved ? 0 : 1)
  } catch (error) {
    console.error('Fatal error:', error)
    process.exit(1)
  }
}

main()
