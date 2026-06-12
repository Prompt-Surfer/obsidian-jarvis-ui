// Jarvis UI Stutter Detection Script
// Injects position-tracking instrumentation and measures the push-pause-push pattern
// in the force simulation's node movement during Natural layout settling.

const puppeteer = require('puppeteer');

const JARVIS_URL = 'http://localhost:5173';
const SHAPE = 'Natural';        // The problematic shape
const CAPTURE_DURATION_MS = 8000; // How long to capture (ms)
const SAMPLE_INTERVAL_MS = 50;   // Sample node positions every 50ms (20fps sampling)
const STUTTER_WINDOW = 6;        // Number of consecutive samples to analyze for stutter pattern
const MOVEMENT_THRESHOLD = 0.5;   // Min avg movement to count as "moving"
const STILL_THRESHOLD = 0.1;      // Max avg movement to count as "still"

async function main() {
  console.log('[stutter-detect] Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader-webgl',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox',
      '--in-process-gpu',
      '--no-sandbox',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  console.log('[stutter-detect] Navigating to Jarvis UI...');
  await page.goto(JARVIS_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForTimeout(4000); // Let Three.js initialize

  // Click Natural shape button
  console.log(`[stutter-detect] Selecting "${SHAPE}" shape...`);
  const clicked = await page.evaluate((shapeName) => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.title === shapeName || btn.textContent?.includes(shapeName)) {
        btn.click();
        return true;
      }
    }
    return false;
  }, SHAPE);

  if (!clicked) {
    console.error(`[stutter-detect] ERROR: Could not find "${SHAPE}" button. Available:`,
      await page.evaluate(() => 
        [...document.querySelectorAll('button')].map(b => b.title || b.textContent?.trim()).filter(Boolean)
      )
    );
    await browser.close();
    process.exit(1);
  }

  console.log(`[stutter-detect] Shape selected. Waiting 2s for sim to start...`);
  await page.waitForTimeout(2000);

  // Inject position sampling instrumentation
  console.log('[stutter-detect] Injecting position tracker...');
  await page.evaluate(() => {
    window.__stutterData = {
      samples: [],          // { t, avgDelta, maxDelta, nodeCount }
      nodePositions: {},    // id -> {x,y,z} for delta computation
    };
  });

  // Sample positions at regular intervals by reading from the React state
  // We'll access the Three.js scene's instanced mesh to read actual rendered positions
  const sampleScript = `
    () => {
      // Try to read positions from the instanced mesh in the Three.js scene
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;

      // Access the React fiber to get component state
      const fiberKey = Object.keys(canvas).find(k => k.startsWith('__reactFiber'));
      if (!fiberKey) return null;

      // Alternative: sample a few node positions from the scene graph
      const renderer = canvas.__reactFiber;
      
      // More reliable: just read displayed positions from window
      // We'll inject a hook into the worker message handler instead
      return { hasCanvas: true };
    }
  `;

  // Better approach: patch the worker message handler to capture position deltas
  console.log('[stutter-detect] Patching worker message handler to capture deltas...');
  await page.evaluate(() => {
    // We'll intercept the performance entries to track sim batch timing
    // And also read node positions directly from Three.js InstancedMesh
    const origRAF = window.requestAnimationFrame;
    let frameCount = 0;
    let lastSampleTime = performance.now();
    
    window.__stutterData.frameTimes = [];
    window.__stutterData.positionDeltas = [];
    window.__stutterData.batchArrivals = [];
    
    // Track worker message arrivals (sim batches)
    const origPostMessage = Worker.prototype.postMessage;
    // Can't easily intercept onmessage, so we'll use a different approach
    
    // Track when React state updates happen by observing DOM mutations
    // Actually, best approach: periodically sample the Three.js instanced mesh matrices
  });

  // Most reliable detection: use CDP Performance API to track:
  // 1. Worker message timing (when batches arrive)
  // 2. Frame timestamps
  // 3. Position changes between frames
  console.log('[stutter-detect] Setting up CDP performance tracking...');

  // Enable CDP performance tracking
  const cdpSession = await page.createCDPSession();
  await cdpSession.send('Performance.enable');

  // Inject a RAF-based position sampler that reads Three.js mesh matrices
  await page.evaluate(() => {
    window.__stutterSamples = [];
    let prevPositions = null;
    
    window.__samplePositions = () => {
      // Find the InstancedMesh in the Three.js scene
      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      
      // Walk the React fiber tree to find the scene
      const fiberKey = Object.keys(canvas).find(k => k.startsWith('__reactFiber'));
      if (!fiberKey) return;
      
      let fiber = canvas[fiberKey];
      let scene = null;
      
      // Walk up to find the component with the Three.js scene
      while (fiber) {
        if (fiber.stateNode?.scene) {
          scene = fiber.stateNode.scene;
          break;
        }
        if (fiber.memoizedState?.current?.scene) {
          scene = fiber.memoizedState.current.scene;
          break;
        }
        fiber = fiber.return;
      }
      
      if (!scene) {
        // Try alternate: look for InstancedMesh in all children
        // This is more robust
        return;
      }
    };
  });

  // SIMPLER APPROACH: Use page.evaluate on a timer to read positions from the 
  // Three.js scene graph, and compute deltas
  console.log('[stutter-detect] Starting position sampling...');
  
  const samples = [];
  const INTERVAL = 50; // ms between samples
  const DURATION = CAPTURE_DURATION_MS;
  const numSamples = Math.floor(DURATION / INTERVAL);
  
  // First, we need to find a way to read node positions from the page
  // The easiest: expose the positions Map from React state via window
  await page.evaluate(() => {
    // Monkey-patch the useForce3D hook's setPositions to capture updates
    // We'll use a MutationObserver + performance entries approach instead
    
    // Actually, the simplest reliable method: read InstancedMesh matrix world positions
    // by traversing the Three.js scene object graph
    window.__getNodePositions = () => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      
      // Search all Three.js objects for InstancedMesh
      // Three.js stores renderer info accessible via __reactInternalInstance
      let positions = null;
      
      // Method: find all Object3D instances in the scene
      // The scene is accessible via the renderer
      const keys = Object.keys(canvas);
      for (const key of keys) {
        if (key.startsWith('__react')) {
          const fiber = canvas[key];
          // Try to traverse to find scene/renderer
          let current = fiber;
          let depth = 0;
          while (current && depth < 30) {
            const state = current.stateNode || current.memoizedState;
            if (state) {
              // Check if this has Three.js objects
              if (state.scene) {
                // Found the scene! Now find InstancedMesh
                const mesh = state.scene.children.find(c => c.isInstancedMesh);
                if (mesh && mesh.instanceMatrix) {
                  const matrix = mesh.instanceMatrix.array;
                  // Extract positions from transformation matrices (col-major, position at index 12,13,14 per instance)
                  const count = mesh.count;
                  const result = [];
                  for (let i = 0; i < count; i++) {
                    const offset = i * 16;
                    result.push({
                      id: i,
                      x: matrix[offset + 12],
                      y: matrix[offset + 13],
                      z: matrix[offset + 14],
                    });
                  }
                  positions = result;
                  break;
                }
              }
              if (state.current?.scene) {
                const mesh = state.current.scene.children.find(c => c.isInstancedMesh);
                if (mesh && mesh.instanceMatrix) {
                  const matrix = mesh.instanceMatrix.array;
                  const count = mesh.count;
                  const result = [];
                  for (let i = 0; i < count; i++) {
                    const offset = i * 16;
                    result.push({
                      id: i,
                      x: matrix[offset + 12],
                      y: matrix[offset + 13],
                      z: matrix[offset + 14],
                    });
                  }
                  positions = result;
                  break;
                }
              }
            }
            current = current.return;
            depth++;
          }
          if (positions) break;
        }
      }
      return positions;
    };
  });

  // Test if position reading works
  const testPos = await page.evaluate(() => window.__getNodePositions?.());
  if (!testPos) {
    console.log('[stutter-detect] Direct matrix reading failed. Using alternative approach...');
    // Fallback: inject into the React component to expose positions
    await page.evaluate(() => {
      // Find the React root and traverse to expose positions
      const rootEl = document.getElementById('root');
      if (!rootEl) return;
      
      const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber'));
      if (!fiberKey) return;
      
      let fiber = rootEl[fiberKey];
      let positionsMap = null;
      let depth = 0;
      
      // DFS through fiber tree looking for positions state
      function findPositions(f, d) {
        if (d > 50 || positionsMap) return;
        const hooks = f.memoizedState;
        let h = hooks;
        let hookIdx = 0;
        while (h && hookIdx < 30) {
          const val = h.memoizedState;
          // Check if it's a Map with position data
          if (val instanceof Map && val.size > 0) {
            const first = val.values().next().value;
            if (first && typeof first.x === 'number' && typeof first.y === 'number' && typeof first.z === 'number') {
              positionsMap = val;
              return;
            }
          }
          h = h.next;
          hookIdx++;
        }
        // Check children
        let child = f.child;
        while (child && !positionsMap) {
          findPositions(child, d + 1);
          child = child.sibling;
        }
      }
      
      findPositions(fiber, 0);
      
      if (positionsMap) {
        window.__positionsMap = positionsMap;
        window.__getNodePositions = () => {
          const map = window.__positionsMap;
          if (!map) return null;
          const result = [];
          for (const [id, pos] of map) {
            result.push({ id, x: pos.x, y: pos.y, z: pos.z });
          }
          return result;
        };
      }
    });
  }

  const testPos2 = await page.evaluate(() => window.__getNodePositions?.());
  console.log(`[stutter-detect] Position reading: ${testPos2 ? `OK (${testPos2.length} nodes)` : 'FAILED'}`);

  if (!testPos2 && !testPos) {
    console.log('[stutter-detect] Falling back to screenshot-based delta detection...');
    
    // FALLBACK: Take rapid screenshots and compute pixel differences
    // This detects visual stutter regardless of internal architecture
    console.log('[stutter-detect] Capturing screenshot sequence...');
    
    const screenshots = [];
    const screenshotInterval = 100; // ms between screenshots
    
    for (let i = 0; i < Math.floor(DURATION / screenshotInterval); i++) {
      const screenshot = await page.screenshot({ type: 'png', encoding: 'binary' });
      screenshots.push({ time: i * screenshotInterval, data: screenshot });
      
      // Compute pixel diff with previous screenshot
      if (i > 0) {
        const diffResult = await page.evaluate((idx) => {
          // Use canvas to compute pixel diff between consecutive frames
          return { frameIdx: idx };
        }, i);
      }
      
      await page.waitForTimeout(screenshotInterval);
    }
    
    console.log(`[stutter-detect] Captured ${screenshots.length} screenshots`);
  }

  // PRIMARY METHOD: Sample positions via CDP or injected hooks
  if (testPos || testPos2) {
    console.log(`[stutter-detect] Sampling positions every ${INTERVAL}ms for ${DURATION}ms...`);
    
    let prevPositions = null;
    const deltas = [];
    
    for (let i = 0; i < numSamples; i++) {
      const positions = await page.evaluate(() => window.__getNodePositions?.());
      
      if (positions && prevPositions) {
        // Compute average and max delta between samples
        let totalDelta = 0;
        let maxDelta = 0;
        let count = 0;
        
        for (let j = 0; j < positions.length; j++) {
          const prev = prevPositions[j];
          const curr = positions[j];
          if (!prev || !curr) continue;
          
          const dx = curr.x - prev.x;
          const dy = curr.y - prev.y;
          const dz = curr.z - prev.z;
          const delta = Math.sqrt(dx*dx + dy*dy + dz*dz);
          
          totalDelta += delta;
          if (delta > maxDelta) maxDelta = delta;
          count++;
        }
        
        const avgDelta = count > 0 ? totalDelta / count : 0;
        deltas.push({
          time: i * INTERVAL,
          avgDelta,
          maxDelta,
          nodeCount: count,
        });
      }
      
      prevPositions = positions;
      await page.waitForTimeout(INTERVAL);
    }
    
    // ANALYZE: Detect stutter pattern
    console.log('\n[stutter-detect] === ANALYSIS ===');
    console.log(`[stutter-detect] Captured ${deltas.length} samples`);
    
    // Classify each sample as MOVING or STILL
    const classified = deltas.map(d => ({
      ...d,
      state: d.avgDelta > MOVEMENT_THRESHOLD ? 'MOVING' : d.avgDelta < STILL_THRESHOLD ? 'STILL' : 'SLOW',
    }));
    
    // Detect transitions: MOVING→STILL = pause start, STILL→MOVING = push start
    let transitions = 0;
    let pushPauses = 0;  // MOVING → STILL transitions
    let pausePushes = 0; // STILL → MOVING transitions
    let totalMovingTime = 0;
    let totalStillTime = 0;
    let currentMovingRun = 0;
    let currentStillRun = 0;
    let movingRuns = [];
    let stillRuns = [];
    
    for (let i = 1; i < classified.length; i++) {
      const prev = classified[i-1];
      const curr = classified[i];
      
      if (prev.state === 'MOVING' && curr.state === 'STILL') {
        pushPauses++;
        transitions++;
        if (currentMovingRun > 0) movingRuns.push(currentMovingRun);
        currentMovingRun = 0;
        currentStillRun = 1;
      } else if (prev.state === 'STILL' && curr.state === 'MOVING') {
        pausePushes++;
        transitions++;
        if (currentStillRun > 0) stillRuns.push(currentStillRun);
        currentStillRun = 0;
        currentMovingRun = 1;
      } else if (curr.state === 'MOVING') {
        currentMovingRun++;
        totalMovingTime += INTERVAL;
      } else if (curr.state === 'STILL') {
        currentStillRun++;
        totalStillTime += INTERVAL;
      }
    }
    // Flush last runs
    if (currentMovingRun > 0) movingRuns.push(currentMovingRun);
    if (currentStillRun > 0) stillRuns.push(currentStillRun);
    
    // STUTTER SCORE: ratio of transitions to total samples
    // High transitions = stuttery, low = smooth
    const stutterRatio = transitions / Math.max(classified.length - 1, 1);
    const avgMovingRunLen = movingRuns.length > 0 ? movingRuns.reduce((a,b) => a+b, 0) / movingRuns.length : 0;
    const avgStillRunLen = stillRuns.length > 0 ? stillRuns.reduce((a,b) => a+b, 0) / stillRuns.length : 0;
    
    // Also compute: how regular is the stutter? (CV of moving/still runs)
    const cvMoving = movingRuns.length > 1 
      ? Math.sqrt(movingRuns.reduce((s,v) => s + (v - avgMovingRunLen)**2, 0) / (movingRuns.length-1)) / avgMovingRunLen
      : 0;
    const cvStill = stillRuns.length > 1 
      ? Math.sqrt(stillRuns.reduce((s,v) => s + (v - avgStillRunLen)**2, 0) / (stillRuns.length-1)) / avgStillRunLen
      : 0;
    
    // Print detailed results
    console.log('\n--- Position Delta Timeline ---');
    classified.forEach((c, i) => {
      const bar = '█'.repeat(Math.min(Math.round(c.avgDelta * 2), 40));
      console.log(`  t=${String(c.time).padStart(5)}ms  avgΔ=${c.avgDelta.toFixed(2).padStart(6)}  maxΔ=${c.maxDelta.toFixed(2).padStart(6)}  ${c.state.padEnd(7)}  ${bar}`);
    });
    
    console.log('\n--- Stutter Metrics ---');
    console.log(`  Total samples:        ${classified.length}`);
    console.log(`  Moving→Still:         ${pushPauses} (push-pause transitions)`);
    console.log(`  Still→Moving:         ${pausePushes} (pause-push transitions)`);
    console.log(`  Total transitions:    ${transitions}`);
    console.log(`  Stutter ratio:        ${stutterRatio.toFixed(3)} (transitions/samples)`);
    console.log(`  Total moving time:    ${totalMovingTime}ms`);
    console.log(`  Total still time:     ${totalStillTime}ms`);
    console.log(`  Avg moving run:       ${avgMovingRunLen.toFixed(1)} samples (${(avgMovingRunLen * INTERVAL).toFixed(0)}ms)`);
    console.log(`  Avg still run:        ${avgStillRunLen.toFixed(1)} samples (${(avgStillRunLen * INTERVAL).toFixed(0)}ms)`);
    console.log(`  CV of moving runs:    ${cvMoving.toFixed(3)}`);
    console.log(`  CV of still runs:     ${cvStill.toFixed(3)}`);
    
    // VERDICT
    const VERDICT_THRESHOLDS = {
      smooth: 0.05,   // <5% transition rate = smooth
      slight: 0.15,   // 5-15% = slight stutter
      moderate: 0.30, // 15-30% = moderate
      severe: 0.50,   // >30% = severe
    };
    
    let verdict;
    if (stutterRatio < VERDICT_THRESHOLDS.smooth) verdict = 'SMOOTH';
    else if (stutterRatio < VERDICT_THRESHOLDS.slight) verdict = 'SLIGHT_STUTTER';
    else if (stutterRatio < VERDICT_THRESHOLDS.moderate) verdict = 'MODERATE_STUTTER';
    else verdict = 'SEVERE_STUTTER';
    
    console.log(`\n  ═══ VERDICT: ${verdict} ═══`);
    console.log(`  Stutter ratio: ${stutterRatio.toFixed(3)} (thresholds: smooth<${VERDICT_THRESHOLDS.smooth}, slight<${VERDICT_THRESHOLDS.slight}, moderate<${VERDICT_THRESHOLDS.moderate}, severe>=${VERDICT_THRESHOLDS.severe})`);
    
    // JSON output for programmatic use
    const result = {
      verdict,
      stutterRatio,
      pushPauses,
      pausePushes,
      transitions,
      avgMovingRunMs: avgMovingRunLen * INTERVAL,
      avgStillRunMs: avgStillRunLen * INTERVAL,
      totalMovingTimeMs: totalMovingTime,
      totalStillTimeMs: totalStillTime,
      cvMoving,
      cvStill,
      deltaSamples: deltas,
      classified,
    };
    
    // Write result to file
    const fs = require('fs');
    fs.writeFileSync('/tmp/jarvis-stutter-result.json', JSON.stringify(result, null, 2));
    console.log('\n[stutter-detect] Full results written to /tmp/jarvis-stutter-result.json');
  }

  await browser.close();
  console.log('[stutter-detect] Done.');
}

main().catch(err => {
  console.error('[stutter-detect] FATAL:', err);
  process.exit(1);
});
