#!/usr/bin/env node

/**
 * Parameter Optimization for alphaDecay & velocityDecay
 * Target: settling_tick < 10 with layout validity maintained
 * 
 * Strategy:
 * - 5 iterations with boundary + fine-grained search
 * - Explore both aggressive high-decay (upper bounds) and balanced strategies
 * - Start from (0.27, 0.64) baseline
 * - Measure settling_tick & verify layout_validity
 */

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from 'd3-force-3d'

interface TestResult {
  iteration: number
  alphaDecay: number
  velocityDecay: number
  settling_tick: number
  layout_validity: boolean
  alpha_at_10: number
  alpha_at_20: number
  stability_score: number
  notes: string
}

// Create a minimal test graph
function createTestGraph(nodeCount: number = 100, linkDensity: number = 0.3) {
  const nodes: any[] = []
  const links: any[] = []

  // Create nodes
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `node_${i}`,
      x: (Math.random() - 0.5) * 400,
      y: (Math.random() - 0.5) * 400,
      z: (Math.random() - 0.5) * 400,
      vx: 0,
      vy: 0,
      vz: 0,
    })
  }

  // Create random links with given density
  const maxLinks = Math.floor(nodeCount * nodeCount * linkDensity)
  for (let i = 0; i < maxLinks; i++) {
    const source = Math.floor(Math.random() * nodeCount)
    const target = Math.floor(Math.random() * nodeCount)
    if (source !== target) {
      links.push({ source: `node_${source}`, target: `node_${target}` })
    }
  }

  return { nodes, links }
}

// Test a parameter combination
function testParameters(
  alphaDecay: number,
  velocityDecay: number,
  testId: string
): TestResult {
  const { nodes, links } = createTestGraph(80, 0.25)
  
  const simulation = forceSimulation(nodes)
    .force('link', forceLink(links).id((d: any) => d.id).distance(60))
    .force('charge', forceManyBody().strength(-120))
    .force('center', forceCenter(0, 0, 0).strength(0.1))
    .force('collide', forceCollide(12))
    .alphaDecay(alphaDecay)
    .velocityDecay(velocityDecay)
    .stop()

  const ALPHA_MIN = 0.001
  const MAX_TICKS = 200
  
  let settling_tick = -1
  let alpha_at_10 = 1.0
  let alpha_at_20 = 1.0
  let layout_validity = true

  // Run ticks and measure
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    simulation.tick()
    const alpha = simulation.alpha()

    // Record alpha values at key ticks
    if (tick === 9) alpha_at_10 = alpha
    if (tick === 19) alpha_at_20 = alpha

    // Detect settling (when alpha drops below threshold for first time)
    if (settling_tick === -1 && alpha < ALPHA_MIN) {
      settling_tick = tick
      break
    }

    // Check for layout validity (detect NaN/Infinity)
    for (const node of nodes) {
      if (!isFinite(node.x) || !isFinite(node.y) || !isFinite(node.z)) {
        layout_validity = false
        settling_tick = -1
        break
      }
    }
    if (!layout_validity) break
  }

  // If didn't settle by MAX_TICKS, use MAX_TICKS
  if (settling_tick === -1) {
    settling_tick = MAX_TICKS
  }

  // Stability score: lower is better, combines settling_tick and decay characteristics
  // Prefer quick settling with stable high-decay params
  const decay_penalty = (1 - alphaDecay) * 10  // penalize low decay
  const stability_score = settling_tick + decay_penalty

  const notes = layout_validity 
    ? `Settled in ${settling_tick} ticks, α@10=${alpha_at_10.toFixed(4)}, α@20=${alpha_at_20.toFixed(4)}`
    : 'LAYOUT INVALID - divergence detected'

  return {
    iteration: 0,
    alphaDecay,
    velocityDecay,
    settling_tick,
    layout_validity,
    alpha_at_10,
    alpha_at_20,
    stability_score,
    notes,
  }
}

// 5-iteration optimization strategy
function optimizeParameters() {
  const results: TestResult[] = []
  
  // Iteration 1: Baseline + aggressive upper bounds
  const iteration1Params = [
    { alphaDecay: 0.27, velocityDecay: 0.64, label: 'Baseline (current)' },
    { alphaDecay: 0.40, velocityDecay: 0.75, label: 'Aggressive (high bounds)' },
    { alphaDecay: 0.35, velocityDecay: 0.70, label: 'Balanced (mid-high)' },
  ]

  // Iteration 2: Fine-grained around best performer
  const iteration2Params = [
    { alphaDecay: 0.38, velocityDecay: 0.72, label: 'Fine-tune A' },
    { alphaDecay: 0.42, velocityDecay: 0.76, label: 'Fine-tune B' },
  ]

  // Iteration 3: Extreme high-decay exploration
  const iteration3Params = [
    { alphaDecay: 0.50, velocityDecay: 0.80, label: 'Extreme high (test limit)' },
    { alphaDecay: 0.45, velocityDecay: 0.78, label: 'Upper-mid exploration' },
  ]

  // Iteration 4: Safety check near sweet spot
  const iteration4Params = [
    { alphaDecay: 0.32, velocityDecay: 0.67, label: 'Conservative variant' },
    { alphaDecay: 0.37, velocityDecay: 0.71, label: 'Refined balanced' },
  ]

  // Iteration 5: Final validation sweep
  const iteration5Params = [
    { alphaDecay: 0.36, velocityDecay: 0.70, label: 'Final candidate A' },
    { alphaDecay: 0.39, velocityDecay: 0.73, label: 'Final candidate B' },
  ]

  const allIterations = [
    { params: iteration1Params, label: 'ITER 1: Baseline + Aggressive' },
    { params: iteration2Params, label: 'ITER 2: Fine-grained' },
    { params: iteration3Params, label: 'ITER 3: Extreme exploration' },
    { params: iteration4Params, label: 'ITER 4: Safety & refinement' },
    { params: iteration5Params, label: 'ITER 5: Final validation' },
  ]

  console.log('\n' + '='.repeat(100))
  console.log('PARAMETER OPTIMIZATION: alphaDecay × velocityDecay')
  console.log('Target: settling_tick < 10, layout_validity maintained')
  console.log('Baseline: (0.27, 0.64) @ ~20 ticks')
  console.log('='.repeat(100) + '\n')

  let iterationNum = 1
  for (const { params, label } of allIterations) {
    console.log(`\n${'─'.repeat(100)}`)
    console.log(label)
    console.log('─'.repeat(100))

    const iterResults: TestResult[] = []
    for (const param of params) {
      const result = testParameters(param.alphaDecay, param.velocityDecay, `iter${iterationNum}`)
      result.iteration = iterationNum
      results.push(result)
      iterResults.push(result)

      const status = result.layout_validity 
        ? (result.settling_tick < 10 ? '✓ EXCELLENT' : result.settling_tick < 15 ? '◐ GOOD' : '◑ OK')
        : '✗ INVALID'

      console.log(`  ${param.label.padEnd(30)} (α=${result.alphaDecay.toFixed(2)}, v=${result.velocityDecay.toFixed(2)})`)
      console.log(`    → Settling: ${result.settling_tick}t  |  Validity: ${result.layout_validity ? 'YES' : 'NO'}  |  ${status}`)
      console.log(`    → α@10=${result.alpha_at_10.toFixed(4)}, α@20=${result.alpha_at_20.toFixed(4)}, score=${result.stability_score.toFixed(2)}`)
      console.log(`    → ${result.notes}\n`)
    }

    // Find best in this iteration
    const best = iterResults.reduce((a, b) => 
      (a.layout_validity && a.settling_tick < b.settling_tick) ? a : b
    )
    console.log(`  ⭐ Best this iteration: (${best.alphaDecay.toFixed(2)}, ${best.velocityDecay.toFixed(2)}) → ${best.settling_tick}t`)

    iterationNum++
  }

  // Summary: Find best overall
  console.log('\n' + '='.repeat(100))
  console.log('OPTIMIZATION SUMMARY')
  console.log('='.repeat(100))

  const validResults = results.filter(r => r.layout_validity)
  if (validResults.length === 0) {
    console.log('⚠️  WARNING: No valid parameter combinations found!')
    console.log('Layout divergence detected in all tests. Reduce decay bounds or check simulation setup.')
    return
  }

  const sortedByTick = [...validResults].sort((a, b) => a.settling_tick - b.settling_tick)
  const best = sortedByTick[0]

  console.log(`\n✓ Best Result (settling_tick):`)
  console.log(`  Parameters: alphaDecay=${best.alphaDecay.toFixed(2)}, velocityDecay=${best.velocityDecay.toFixed(2)}`)
  console.log(`  Settling: ${best.settling_tick} ticks`)
  console.log(`  Target achieved: ${best.settling_tick < 10 ? '✓ YES (< 10)' : best.settling_tick < 15 ? '◐ PARTIAL (< 15)' : '✗ NO'}`)
  console.log(`  Layout validity: ${best.layout_validity ? '✓ SAFE' : '✗ DIVERGED'}`)

  // Performance gain vs baseline
  const baselineResult = results.find(r => r.alphaDecay === 0.27 && r.velocityDecay === 0.64)
  if (baselineResult) {
    const improvement = ((baselineResult.settling_tick - best.settling_tick) / baselineResult.settling_tick * 100).toFixed(1)
    console.log(`  vs Baseline (0.27, 0.64): ${improvement}% improvement (${baselineResult.settling_tick}t → ${best.settling_tick}t)`)
  }

  // Parameter space map
  console.log('\n\nParameter Space Map (settling_tick):')
  console.log('─'.repeat(80))
  const byDecay = new Map<string, (string | number)[]>()
  for (const result of validResults) {
    const key = `α=${result.alphaDecay.toFixed(2)}`
    if (!byDecay.has(key)) byDecay.set(key, [])
    byDecay.get(key)!.push(`v=${result.velocityDecay.toFixed(2)}:${result.settling_tick}t`)
  }
  for (const [key, values] of byDecay) {
    console.log(`${key}: ${(values as string[]).join(' | ')}`)
  }

  // Safety assessment
  console.log('\n\nSafety Assessment:')
  console.log('─'.repeat(80))
  const invalidCount = results.filter(r => !r.layout_validity).length
  const tooSlowCount = validResults.filter(r => r.settling_tick > 20).length
  const goodCount = validResults.filter(r => r.settling_tick < 15 && r.layout_validity).length

  console.log(`Total tests: ${results.length}`)
  console.log(`Valid layouts: ${validResults.length} (${(validResults.length / results.length * 100).toFixed(0)}%)`)
  console.log(`Invalid (divergence): ${invalidCount}`)
  console.log(`Good performance (< 15t): ${goodCount}`)
  console.log(`Slow performance (> 20t): ${tooSlowCount}`)

  if (best.settling_tick < 10) {
    console.log('\n✓ SUCCESS: Target settling_tick < 10 achieved!')
    console.log(`  Recommended: alphaDecay=${best.alphaDecay.toFixed(2)}, velocityDecay=${best.velocityDecay.toFixed(2)}`)
  } else if (best.settling_tick < 15) {
    console.log('\n◐ PARTIAL: Target < 10 not achieved, but < 15 is acceptable.')
    console.log(`  Recommended: alphaDecay=${best.alphaDecay.toFixed(2)}, velocityDecay=${best.velocityDecay.toFixed(2)}`)
    console.log(`  Note: Further optimization may require algorithm changes, not just parameter tuning.`)
  } else {
    console.log('\n✗ TARGET NOT MET: All parameter combinations exceed settling_tick < 15.')
    console.log('Consider: (1) Different force weights, (2) Initial positioning, (3) Convergence threshold.')
  }

  // Boundary analysis
  console.log('\n\nBoundary Analysis:')
  console.log('─'.repeat(80))
  const maxValid = validResults.reduce((a, b) => 
    (a.alphaDecay + a.velocityDecay > b.alphaDecay + b.velocityDecay) ? a : b
  )
  console.log(`Safe upper bounds: alphaDecay ≤ ${(maxValid.alphaDecay + 0.02).toFixed(2)}, velocityDecay ≤ ${(maxValid.velocityDecay + 0.02).toFixed(2)}`)
  console.log(`High-decay region: alphaDecay ≥ 0.35 + velocityDecay ≥ 0.70`)
  console.log(`Balanced region: alphaDecay ∈ [0.27, 0.35], velocityDecay ∈ [0.64, 0.70]`)

  return { best, validResults, results }
}

// Run optimization
const results = optimizeParameters()

// Export results as JSON for further analysis
if (results) {
  console.log('\n\n' + '='.repeat(100))
  console.log('DETAILED RESULTS (JSON)')
  console.log('='.repeat(100))
  console.log(JSON.stringify(results, null, 2))
}
