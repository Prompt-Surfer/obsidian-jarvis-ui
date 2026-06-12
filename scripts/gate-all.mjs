#!/usr/bin/env node

/**
 * Master Correctness Gate Runner
 * 
 * Chains static validation + runtime correctness checks
 * to ensure performance fixes don't break the graph.
 * 
 * Usage:
 *   npm run gate
 *   npm run gate -- --headless false  (interactive browser)
 * 
 * Exit codes:
 *   0 = all gates passed
 *   1 = static or runtime validation failed
 *   2 = fatal error
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2).join(' ');
const timestamp = new Date().toISOString().split('T')[0];

console.log('');
console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
console.log('║         JARVIS CORRECTNESS GATE — Static + Runtime Validation                  ║');
console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
console.log('');

const results = {
  timestamp,
  phases: {},
  overallStatus: 'PASS',
};

// **PHASE 1: Static Validation**
console.log('┌─ PHASE 1: Static Validation ────────────────────────────────────────────────────┐');
console.log('│ Checking source code, build artifacts, and force parameters');
console.log('└─────────────────────────────────────────────────────────────────────────────────┘');
console.log('');

try {
  execSync('node scripts/gate-static-validation.mjs --output /tmp/gate-static-results.json', {
    stdio: 'inherit',
  });

  const staticReport = JSON.parse(fs.readFileSync('/tmp/gate-static-results.json', 'utf-8'));
  results.phases.staticValidation = staticReport;

  if (staticReport.status === 'FAIL') {
    console.error('\n❌ Static validation FAILED');
    results.overallStatus = 'FAIL';
    process.exit(1);
  } else {
    console.log('\n✅ Static validation PASSED');
  }
} catch (err) {
  console.error(`\n❌ Static validation error: ${err.message}`);
  results.overallStatus = 'FAIL';
  process.exit(2);
}

// **PHASE 2: Build**
console.log('\n┌─ PHASE 2: Build ───────────────────────────────────────────────────────────────┐');
console.log('│ Compiling TypeScript and bundling assets');
console.log('└─────────────────────────────────────────────────────────────────────────────────┘');
console.log('');

try {
  execSync('npm run build', { stdio: 'inherit' });
  results.phases.build = { status: 'PASS', message: 'Build completed successfully' };
  console.log('\n✅ Build PASSED');
} catch (err) {
  console.error(`\n❌ Build FAILED: ${err.message}`);
  results.overallStatus = 'FAIL';
  process.exit(1);
}

// **PHASE 3: Runtime Correctness**
console.log('\n┌─ PHASE 3: Runtime Correctness ─────────────────────────────────────────────────┐');
console.log('│ Launching dev server and validating graph rendering/convergence');
console.log('└─────────────────────────────────────────────────────────────────────────────────┘');
console.log('');

try {
  // Start dev servers
  console.log('[gate] Starting dev servers...');
  execSync('pkill -f "vite.*5173" 2>/dev/null; pkill -f "tsx.*server" 2>/dev/null; sleep 2', {
    stdio: 'pipe',
  });
  execSync(
    'nohup npx tsx server/index.ts > /tmp/gate-api.log 2>&1 & nohup npx vite --host 127.0.0.1 --port 5173 > /tmp/gate-vite.log 2>&1 &',
    { stdio: 'pipe' }
  );
  execSync('sleep 10'); // Wait for servers to start

  // Run runtime correctness gate
  execSync(`node scripts/gate-correctness.mjs ${args} --output /tmp/gate-runtime-results.json`, {
    stdio: 'inherit',
  });

  const runtimeReport = JSON.parse(fs.readFileSync('/tmp/gate-runtime-results.json', 'utf-8'));
  results.phases.runtimeCorrectness = runtimeReport;

  if (runtimeReport.status === 'FAIL') {
    console.error('\n❌ Runtime correctness FAILED');
    results.overallStatus = 'FAIL';
  } else {
    console.log('\n✅ Runtime correctness PASSED');
  }

  // Clean up
  execSync('pkill -f "vite.*5173" 2>/dev/null; pkill -f "tsx.*server" 2>/dev/null', {
    stdio: 'pipe',
  });
} catch (err) {
  console.error(`\n❌ Runtime correctness error: ${err.message}`);
  results.overallStatus = 'FAIL';
  execSync('pkill -f "vite.*5173" 2>/dev/null; pkill -f "tsx.*server" 2>/dev/null', {
    stdio: 'pipe',
  });
  process.exit(1);
}

// **FINAL REPORT**
console.log('');
console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
if (results.overallStatus === 'PASS') {
  console.log('║                          ✅ ALL GATES PASSED ✅                                 ║');
  console.log('║         Graph is correct, performance fixes are safe to deploy                ║');
} else {
  console.log('║                          ❌ GATE FAILED ❌                                     ║');
  console.log('║                Review errors above and fix before deploying                   ║');
}
console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
console.log('');

// Write combined report
const reportPath = `gate-results-${timestamp}.json`;
fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
console.log(`Combined report: ${reportPath}\n`);

process.exit(results.overallStatus === 'PASS' ? 0 : 1);
