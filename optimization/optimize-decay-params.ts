#!/usr/bin/env node
/**
 * Systematic parameter space exploration for alphaDecay and velocityDecay optimization
 * 
 * Goal: Achieve settling_tick < 10 (50%+ improvement from baseline ~20-22 ticks)
 * Baseline: alphaDecay=0.27, velocityDecay=0.64
 * Strategy: Test 5 iterations increasing decay rates to dampen oscillations
 * Budget: 5 iterations, stall after 3 no-improvement rounds
 */

import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force-3d'

interface BenchmarkNode {
  id: string
  folder: string
  tags?: string[]
  x?: number
  y?: number
  z?: number
  vx?: number
  vy?: number
  vz?: number
}

interface BenchmarkLink {
  source: string
  target: string
}

interface OptimizationResult {
  iteration: number
  alphaDecay: number
  velocityDecay: number
  settlingTick: number
  layoutValid: boolean
  convergenceTime: number
  alpha_final: number
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
}

// Generate a larger synthetic graph closer to real vault (150-200 nodes)
function generateSyntheticGraph(): { nodes: BenchmarkNode[]; links: BenchmarkLink[] } {
  const nodes: BenchmarkNode[] = []
  const links: BenchmarkLink[] = []

  const folders = ['projects', 'research', 'personal', 'work', 'notes']
  const tags = ['important', 'archive', 'draft', 'review', 'published']

  // 150 nodes
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

  // ~200 links with realistic density
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
 * Run a single force simulation benchmark with given decay parameters
 */
function runBenchmark(
  alphaDecay: number,
  velocityDecay: number,
  nodes: BenchmarkNode[],
  links: BenchmarkLink[],
): OptimizationResult {
  const ALPHA_MIN = 0.001
  const MAX_TICKS = 200

  // Setup nodes with fresh random positions
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
  })) as any

  const simLinks = links.map((l) => ({
    source: l.source,
    target: l.target,
  })) as any

  const startTime = performance.now()

  // Create simulation with current decay parameters
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
    .velocityDecay(velocityDecay)
    .stop()

  let settlingTick = 0
  let finalAlpha = 1.0

  // Run simulation ticks until convergence
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    simulation.tick()
    settlingTick = tick + 1
    finalAlpha = simulation.alpha()

    // Check convergence
    if (simulation.alpha() < ALPHA_MIN) {
      settlingTick = tick + 1
      break
    }
  }

  // Check layout validity (bounds safety gate)
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
  const layoutValid = diameterXY < 2000

  const convergenceTime = performance.now() - startTime

  return {
    iteration: 0, // Will be set by caller
    alphaDecay,
    velocityDecay,
    settlingTick,
    layoutValid,
    convergenceTime,
    alpha_final: finalAlpha,
    bounds,
  }
}

/**
 * Systematic parameter space exploration
 * Strategy: Increase both decay rates iteratively to dampen oscillations
 */
async function systematicParameterOptimization(
  nodes: BenchmarkNode[],
  links: BenchmarkLink[],
) {
  const results: OptimizationResult[] = []
  const TARGET_SETTLING_TICK = 10
  const BASELINE_SETTLING_TICK = 21 // ~20-22 ticks reported
  let noImprovementCount = 0
  let bestResult: OptimizationResult | null = null

  // Parameter space: increase both decay rates progressively
  // Baseline: alphaDecay=0.27, velocityDecay=0.64
  const parameterConfigs = [
    { alphaDecay: 0.27, velocityDecay: 0.64 }, // Baseline
    { alphaDecay: 0.35, velocityDecay: 0.70 }, // +29% alpha, +9% velocity
    { alphaDecay: 0.42, velocityDecay: 0.75 }, // +56% alpha, +17% velocity
    { alphaDecay: 0.50, velocityDecay: 0.80 }, // +85% alpha, +25% velocity
    { alphaDecay: 0.58, velocityDecay: 0.85 }, // +115% alpha, +33% velocity
  ]

  console.log('='.repeat(100))
  console.log('ALPHADECAY & VELOCITYDECAY OPTIMIZATION')
  console.log('='.repeat(100))
  console.log(`Goal: settling_tick < ${TARGET_SETTLING_TICK} (50%+ improvement from baseline ~${BASELINE_SETTLING_TICK} ticks)`)
  console.log(`Baseline: alphaDecay=0.27, velocityDecay=0.64`)
  console.log(`Strategy: Systematic parameter space exploration (5 iterations)`)
  console.log(`Safety gate: Monitor layout_validity (diameter < 2000)`)
  console.log(`Budget: 5 iterations, stall after 3 no-improvement rounds`)
  console.log(''.repeat(100))
  console.log('')

  for (let iter = 0; iter < parameterConfigs.length; iter++) {
    const config = parameterConfigs[iter]

    console.log(`[Iteration ${iter + 1}/5] Testing alphaDecay=${config.alphaDecay}, velocityDecay=${config.velocityDecay}`)

    const result: OptimizationResult = runBenchmark(config.alphaDecay, config.velocityDecay, nodes, links)
    result.iteration = iter + 1

    results.push(result)

    const diameterXY = Math.sqrt(
      Math.pow(result.bounds.maxX - result.bounds.minX, 2) +
        Math.pow(result.bounds.maxY - result.bounds.minY, 2),
    )

    console.log(`  ✓ Settling tick: ${result.settlingTick}`)
    console.log(`  ✓ Layout validity: ${result.layoutValid ? '✓ YES' : '✗ NO (diameter: ' + diameterXY.toFixed(0) + ')'} `)
    console.log(`  ✓ Final alpha: ${result.alpha_final.toFixed(6)}`)
    console.log(`  ✓ Convergence time: ${result.convergenceTime.toFixed(2)}ms`)
    console.log('')

    // Check improvement
    if (bestResult === null || result.settlingTick < bestResult.settlingTick) {
      if (bestResult !== null) {
        const improvementDelta = bestResult.settlingTick - result.settlingTick
        console.log(`  ↑ IMPROVEMENT: settling_tick reduced by ${improvementDelta} ticks (${((improvementDelta / bestResult.settlingTick) * 100).toFixed(1)}%)`)
      }
      bestResult = result
      noImprovementCount = 0
    } else {
      noImprovementCount++
      console.log(`  → No improvement (stall count: ${noImprovementCount}/3)`)
    }

    // Safety gate: if layout exploded, mark and note
    if (!result.layoutValid) {
      console.log(`  ⚠ WARNING: Layout validity compromised! Bounds exceed safety gate (2000).`)
    }

    // Target achievement check
    if (result.settlingTick < TARGET_SETTLING_TICK) {
      console.log(`  ✅ TARGET ACHIEVED! settling_tick (${result.settlingTick}) < ${TARGET_SETTLING_TICK}`)
    }

    // Early exit if no improvement for 3 consecutive iterations (budget constraint)
    if (noImprovementCount >= 3) {
      console.log(`\n⊘ STALL DETECTED: No improvement for 3 consecutive iterations. Stopping search.`)
      console.log(`Remaining iterations (${5 - iter - 1}) skipped per budget constraint.`)
      break
    }

    console.log(''.repeat(100))
  }

  // Print comprehensive summary
  console.log('='.repeat(100))
  console.log('OPTIMIZATION RESULTS SUMMARY')
  console.log('='.repeat(100))
  console.log('')
  console.log(`Baseline settling_tick:     ${BASELINE_SETTLING_TICK} ticks`)
  console.log(`Target settling_tick:       < ${TARGET_SETTLING_TICK} ticks`)
  if (bestResult) {
    console.log(`Best settling_tick achieved: ${bestResult.settlingTick} ticks`)
    const improvement = BASELINE_SETTLING_TICK - bestResult.settlingTick
    const improvementPct = (improvement / BASELINE_SETTLING_TICK) * 100
    console.log(`Total improvement:          ${improvement} ticks (${improvementPct.toFixed(1)}%)`)
    console.log(`Best parameters:            alphaDecay=${bestResult.alphaDecay}, velocityDecay=${bestResult.velocityDecay}`)
    console.log(`Layout validity:            ${bestResult.layoutValid ? '✓ VALID' : '✗ INVALID'}`)
    console.log(`Target achievement:         ${bestResult.settlingTick < TARGET_SETTLING_TICK ? '✅ YES' : '⚠ NO'}`)
  }
  console.log('')

  console.log('COMPLETE ITERATION LOG:')
  console.log('-'.repeat(100))
  console.table(
    results.map((r) => ({
      Iteration: r.iteration,
      alphaDecay: r.alphaDecay.toFixed(4),
      velocityDecay: r.velocityDecay.toFixed(4),
      settling_tick: r.settlingTick,
      layout_valid: r.layoutValid ? 'YES' : 'NO',
      alpha_final: r.alpha_final.toFixed(6),
      convergence_ms: r.convergenceTime.toFixed(2),
    })),
  )
  console.log('-'.repeat(100))
  console.log('')

  // Improvement trajectory
  console.log('IMPROVEMENT TRAJECTORY:')
  console.log('-'.repeat(100))
  let currentBest = BASELINE_SETTLING_TICK
  for (const r of results) {
    const improvement = currentBest - r.settlingTick
    const improvementPct = improvement > 0 ? ((improvement / currentBest) * 100).toFixed(1) : '0.0'
    const status = r.settlingTick < currentBest ? '↑' : r.settlingTick === currentBest ? '=' : '↓'
    console.log(`  Iter ${r.iteration}: ${status} settling_tick = ${r.settlingTick.toString().padStart(2)} (delta: ${improvement > 0 ? '+' : ''}${improvement} ticks, ${improvementPct}%)`)
    if (r.settlingTick < currentBest) currentBest = r.settlingTick
  }
  console.log('-'.repeat(100))
  console.log('')

  // Confidence metrics
  console.log('CONFIDENCE METRICS:')
  console.log('-'.repeat(100))
  if (bestResult) {
    const avgSettlingTick = results.reduce((sum, r) => sum + r.settlingTick, 0) / results.length
    const variance = results.reduce((sum, r) => sum + Math.pow(r.settlingTick - avgSettlingTick, 2), 0) / results.length
    const stdDev = Math.sqrt(variance)
    const validLayouts = results.filter(r => r.layoutValid).length

    console.log(`  Iterations run:             ${results.length}/5`)
    console.log(`  Average settling_tick:      ${avgSettlingTick.toFixed(2)}`)
    console.log(`  Std deviation:              ${stdDev.toFixed(2)}`)
    console.log(`  Best settling_tick:         ${bestResult.settlingTick}`)
    console.log(`  Worst settling_tick:        ${Math.max(...results.map(r => r.settlingTick))}`)
    console.log(`  Valid layouts:              ${validLayouts}/${results.length}`)
    console.log(`  Improvement confidence:     ${bestResult.settlingTick < BASELINE_SETTLING_TICK ? 'HIGH ✓' : 'LOW ✗'}`)
  }
  console.log('-'.repeat(100))
  console.log('')

  // Final recommendation
  console.log('FINAL RECOMMENDATION:')
  console.log('='.repeat(100))
  if (bestResult) {
    if (bestResult.settlingTick < TARGET_SETTLING_TICK) {
      console.log(`✅ SUCCESS: Target achieved with settling_tick = ${bestResult.settlingTick} < ${TARGET_SETTLING_TICK}`)
      console.log(`   Recommended parameters:`)
      console.log(`   • alphaDecay: ${bestResult.alphaDecay} (was 0.27, +${((bestResult.alphaDecay / 0.27 - 1) * 100).toFixed(0)}%)`)
      console.log(`   • velocityDecay: ${bestResult.velocityDecay} (was 0.64, +${((bestResult.velocityDecay / 0.64 - 1) * 100).toFixed(0)}%)`)
      console.log(`   • Improvement: ${BASELINE_SETTLING_TICK - bestResult.settlingTick} ticks (${(((BASELINE_SETTLING_TICK - bestResult.settlingTick) / BASELINE_SETTLING_TICK) * 100).toFixed(1)}%)`)
    } else if (bestResult.settlingTick < BASELINE_SETTLING_TICK) {
      console.log(`⚠ PARTIAL SUCCESS: Target not fully achieved, but improvement made`)
      console.log(`   Recommended parameters:`)
      console.log(`   • alphaDecay: ${bestResult.alphaDecay} (was 0.27, +${((bestResult.alphaDecay / 0.27 - 1) * 100).toFixed(0)}%)`)
      console.log(`   • velocityDecay: ${bestResult.velocityDecay} (was 0.64, +${((bestResult.velocityDecay / 0.64 - 1) * 100).toFixed(0)}%)`)
      console.log(`   • Current settling_tick: ${bestResult.settlingTick} (target: < ${TARGET_SETTLING_TICK})`)
      console.log(`   • Improvement: ${BASELINE_SETTLING_TICK - bestResult.settlingTick} ticks (${(((BASELINE_SETTLING_TICK - bestResult.settlingTick) / BASELINE_SETTLING_TICK) * 100).toFixed(1)}%)`)
      console.log(`   • Note: Further parameter tuning or layout adjustments may be needed`)
    } else {
      console.log(`❌ NO IMPROVEMENT: Best found settling_tick = ${bestResult.settlingTick} (target: < ${TARGET_SETTLING_TICK})`)
      console.log(`   • Suggest: Increase decay rates further or adjust other forces`)
    }
  }
  console.log('='.repeat(100))

  return {
    bestResult,
    results,
    targetAchieved: bestResult ? bestResult.settlingTick < TARGET_SETTLING_TICK : false,
  }
}

/**
 * Main entry point
 */
async function main() {
  try {
    console.log('Generating synthetic graph (150 nodes, ~200 links)...\n')
    const { nodes, links } = generateSyntheticGraph()
    console.log(`  ✓ Nodes: ${nodes.length}`)
    console.log(`  ✓ Links: ${links.length}\n`)

    const optimizationResult = await Promise.resolve(systematicParameterOptimization(nodes, links))

    // Exit with appropriate code
    process.exit(optimizationResult.targetAchieved ? 0 : 1)
  } catch (error) {
    console.error('Fatal error:', error)
    process.exit(1)
  }
}

main()
