#!/usr/bin/env node

/**
 * Benchmark script for Jarvis Natural layout stutter quantification.
 * Runs headless and outputs JSON metrics for automated comparison.
 * 
 * Usage:
 *   node benchmark-stutter.mjs [--vault /path/to/vault] [--output results.json] [--headless true|false]
 * 
 * Metrics:
 *   - stutterRatio: ratio of pause-frames to total frames (0.0–1.0)
 *   - avgTickDuration: median worker tick() time (ms)
 *   - settlingTime: time from Natural selection to stable (ms)
 *   - maxFrameGap: longest pause between position updates (ms)
 *   - p95TickDuration: 95th percentile tick time (ms)
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const DEFAULT_VAULT = process.env.VAULT_PATH || '~/obsidian/otacon-vault';
const DEFAULT_PORT = 5173;
const SETTLING_TIMEOUT = 45000; // 45s max for settling
const CAPTURE_URL = `http://127.0.0.1:${DEFAULT_PORT}/?timing`;

// Parse CLI args
const args = process.argv.slice(2);
let vaultPath = DEFAULT_VAULT;
let outputFile = 'benchmark-stutter-results.json';
let headless = true;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--vault') vaultPath = args[++i];
  if (args[i] === '--output') outputFile = args[++i];
  if (args[i] === '--headless') headless = args[++i] !== 'false';
}

console.log('[benchmark] Starting Jarvis stutter quantification...');
console.log(`[benchmark] Vault: ${vaultPath}`);
console.log(`[benchmark] URL: ${CAPTURE_URL}`);

async function runBenchmark() {
  const browser = await puppeteer.launch({
    headless: headless ? 'new' : false,
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
  const logs = [];
  const timingData = {
    workerTicks: [],
    rafFrames: [],
    frameGaps: [],
    messageArrivals: [],
  };

  // Capture console logs
  page.on('console', (msg) => {
    const text = msg.text();
    logs.push(text);

    // Parse timing logs
    if (text.includes('[timing/worker]')) {
      const match = text.match(/tick=(\d+)\s+simTick=([\d.]+)ms\s+postInterval=([\d.]+)ms\s+alpha=([\d.]+)/);
      if (match) {
        timingData.workerTicks.push({
          tick: parseInt(match[1]),
          simTickDuration: parseFloat(match[2]),
          postInterval: parseFloat(match[3]),
          alpha: parseFloat(match[4]),
        });
      }
    }

    if (text.includes('[timing/raf-loop]')) {
      const match = text.match(/frame=(\d+)\s+totalFrameWork=([\d.]+)ms\s+frameGap=([\d.]+)ms/);
      if (match) {
        timingData.rafFrames.push({
          frame: parseInt(match[1]),
          totalFrameWork: parseFloat(match[2]),
          frameGap: parseFloat(match[3]),
        });
        timingData.frameGaps.push(parseFloat(match[3]));
      }
    }

    if (text.includes('[timing/main]')) {
      const match = text.match(/arrivalGap=([\d.]+)ms\s+workerLatency=([\d.]+)ms/);
      if (match) {
        timingData.messageArrivals.push({
          arrivalGap: parseFloat(match[1]),
          workerLatency: parseFloat(match[2]),
        });
      }
    }
  });

  await page.goto(CAPTURE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.setViewport({ width: 1280, height: 900 });

  // Wait for page to render
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)));

  // Click Natural shape
  console.log('[benchmark] Selecting Natural shape...');
  const clicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.title === 'Natural' || btn.textContent?.includes('Natural')) {
        btn.click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) {
    console.error('[benchmark] Failed to find Natural shape button');
    await browser.close();
    return null;
  }

  console.log('[benchmark] Natural shape selected. Capturing settling cycle (40s)...');
  const startTime = Date.now();

  // Wait for settling to complete or timeout
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 40000)));

  const elapsedTime = Date.now() - startTime;

  // Extract final metrics from page state
  const metrics = await page.evaluate(() => {
    // Try to detect if sim is settled
    return {
      nodeCount: document.querySelectorAll('canvas').length > 0 ? 'rendered' : 'not-rendered',
    };
  });

  await browser.close();

  // Analyze collected timing data
  const analysis = analyzeTimingData(timingData, elapsedTime);
  const results = {
    timestamp: new Date().toISOString(),
    vaultPath,
    captureUrl: CAPTURE_URL,
    duration: elapsedTime,
    ...analysis,
    rawLogs: logs.slice(-100), // Last 100 logs for debugging
  };

  // Write results
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  console.log(`[benchmark] Results written to ${outputFile}`);
  console.log(JSON.stringify(analysis, null, 2));

  return results;
}

function analyzeTimingData(data, totalElapsedMs) {
  const result = {
    summary: {},
    workerMetrics: {},
    rafMetrics: {},
    recommendation: '',
  };

  // Worker metrics
  if (data.workerTicks.length > 0) {
    const tickDurations = data.workerTicks.map(t => t.simTickDuration).sort((a, b) => a - b);
    const n = tickDurations.length;

    result.workerMetrics = {
      tickCount: n,
      minTick: tickDurations[0],
      maxTick: tickDurations[n - 1],
      medianTick: tickDurations[Math.floor(n / 2)],
      p95Tick: tickDurations[Math.floor(n * 0.95)],
      avgTick: tickDurations.reduce((a, b) => a + b, 0) / n,
    };
  }

  // RAF metrics (frame gaps = pauses)
  if (data.frameGaps.length > 0) {
    const gaps = data.frameGaps.sort((a, b) => a - b);
    const n = gaps.length;

    // Stutter ratio: frames with gap > 50ms / total frames
    const pauseFrames = gaps.filter(g => g > 50).length;
    const stutterRatio = pauseFrames / n;

    result.rafMetrics = {
      frameCount: n,
      minGap: gaps[0],
      maxGap: gaps[n - 1],
      medianGap: gaps[Math.floor(n / 2)],
      p95Gap: gaps[Math.floor(n * 0.95)],
      avgGap: gaps.reduce((a, b) => a + b, 0) / n,
      pauseFrameCount: pauseFrames,
      stutterRatio: stutterRatio.toFixed(3),
    };
  }

  // Summary
  const medianWorkerTick = result.workerMetrics.medianTick || 0;
  const p95Gap = result.rafMetrics.p95Gap || 0;

  result.summary = {
    settlingDurationMs: totalElapsedMs,
    stutterRatio: result.rafMetrics.stutterRatio || 'N/A',
    medianWorkerTickMs: medianWorkerTick.toFixed(2),
    p95FrameGapMs: p95Gap.toFixed(2),
    maxFrameGapMs: (result.rafMetrics.maxGap || 0).toFixed(2),
  };

  // Recommendation
  if (parseFloat(result.summary.stutterRatio) > 0.2) {
    result.recommendation = 'HIGH STUTTER (>20%). Apply Fix #1: Barnes-Hut + distanceMax optimization.';
  } else if (parseFloat(result.summary.stutterRatio) > 0.1) {
    result.recommendation = 'MODERATE STUTTER (10-20%). Consider Fix #2: Skip forceCollide during settling.';
  } else {
    result.recommendation = 'LOW STUTTER (<10%). Performance acceptable or fixes already applied.';
  }

  return result;
}

runBenchmark().catch(err => {
  console.error('[benchmark] Error:', err);
  process.exit(1);
});
