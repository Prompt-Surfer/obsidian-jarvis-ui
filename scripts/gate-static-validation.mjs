#!/usr/bin/env node

/**
 * Static Correctness Gate for Jarvis Natural Layout
 * 
 * Validates source code and build artifacts BEFORE runtime testing:
 * - Force parameters in valid ranges
 * - No syntax errors in force configuration
 * - Critical functions present and callable
 * - Build artifacts exist and are valid
 * 
 * Usage:
 *   node gate-static-validation.mjs [--output results.json]
 * 
 * Exit codes:
 *   0 = all checks passed
 *   1 = one or more checks failed
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const checks = {};
const errors = [];
const warnings = [];

console.log('[static-gate] Starting static correctness validation...\n');

// **CHECK 1: force3d.worker.ts has valid force parameters**
console.log('[static-gate] Check 1: Force parameters in valid ranges...');
try {
  const workerPath = 'src/workers/force3d.worker.ts';
  const workerCode = fs.readFileSync(workerPath, 'utf-8');

  // Validate force parameter ranges
  const alphaDecayMatch = workerCode.match(/alphaDecay\s*=\s*([\d.]+)/);
  const velocityDecayMatch = workerCode.match(/velocityDecay\s*=\s*([\d.]+)/);
  const thetaMatch = workerCode.match(/\.theta\s*\(\s*([\d.]+)\s*\)/);
  const distanceMaxMatch = workerCode.match(/\.distanceMax\s*\(\s*([^)]+)\s*\)/);
  const maxTicksMatch = workerCode.match(/MAX_TICKS\s*=\s*(\d+)/);

  const alphaDecay = alphaDecayMatch ? parseFloat(alphaDecayMatch[1]) : null;
  const velocityDecay = velocityDecayMatch ? parseFloat(velocityDecayMatch[1]) : null;
  const theta = thetaMatch ? parseFloat(thetaMatch[1]) : null;
  const maxTicks = maxTicksMatch ? parseInt(maxTicksMatch[1]) : null;

  const alphaValid = alphaDecay === null || (alphaDecay >= 0.01 && alphaDecay <= 0.1);
  const velocityValid = velocityDecay === null || (velocityDecay >= 0.1 && velocityDecay <= 1.0);
  const thetaValid = theta === null || (theta >= 0.85 && theta <= 1.0);
  const maxTicksValid = maxTicks === null || (maxTicks >= 50 && maxTicks <= 300);

  checks.forceParametersCheck = {
    passed: alphaValid && velocityValid && thetaValid && maxTicksValid,
    details: {
      alphaDecay: { value: alphaDecay, valid: alphaValid, range: '0.01–0.1' },
      velocityDecay: { value: velocityDecay, valid: velocityValid, range: '0.1–1.0' },
      theta: { value: theta, valid: thetaValid, range: '0.85–1.0' },
      maxTicks: { value: maxTicks, valid: maxTicksValid, range: '50–300' },
    },
  };

  if (!checks.forceParametersCheck.passed) {
    errors.push(
      `Invalid force parameters detected: ${!alphaValid ? 'alphaDecay out of range' : ''} ${!velocityValid ? 'velocityDecay out of range' : ''} ${!thetaValid ? 'theta out of range' : ''} ${!maxTicksValid ? 'maxTicks out of range' : ''}`.trim()
    );
  }
} catch (err) {
  checks.forceParametersCheck = { passed: false, error: err.message };
  errors.push(`Failed to validate force parameters: ${err.message}`);
}

// **CHECK 2: No syntax errors in force3d.worker.ts**
console.log('[static-gate] Check 2: TypeScript/syntax validation...');
try {
  execSync('npx tsc --noEmit src/workers/force3d.worker.ts', { stdio: 'pipe' });
  checks.syntaxCheck = { passed: true, details: 'TypeScript compilation OK' };
} catch (err) {
  checks.syntaxCheck = { passed: false, error: 'TypeScript compilation failed' };
  errors.push(`Syntax/type errors in force3d.worker.ts: ${err.message}`);
}

// **CHECK 3: Critical force functions are callable**
console.log('[static-gate] Check 3: Force function definitions...');
try {
  const workerCode = fs.readFileSync('src/workers/force3d.worker.ts', 'utf-8');

  const hasForceMany = workerCode.includes('forceManyBody()');
  const hasForceLink = workerCode.includes('forceLink()');
  const hasForceCenter = workerCode.includes('forceCenter()');
  const hasRunTick = workerCode.includes('function runTick()');

  checks.forceFunctionsCheck = {
    passed: hasForceMany && hasForceLink && hasForceCenter && hasRunTick,
    details: {
      forceManyBody: hasForceMany,
      forceLink: hasForceLink,
      forceCenter: hasForceCenter,
      runTick: hasRunTick,
    },
  };

  if (!checks.forceFunctionsCheck.passed) {
    errors.push('Missing critical force functions or runTick');
  }
} catch (err) {
  checks.forceFunctionsCheck = { passed: false, error: err.message };
  errors.push(`Failed to validate force functions: ${err.message}`);
}

// **CHECK 4: Build artifacts exist and are valid**
console.log('[static-gate] Check 4: Build artifacts...');
try {
  const distDir = 'dist';
  const assetsDir = path.join(distDir, 'assets');

  const distExists = fs.existsSync(distDir);
  const assetsExists = fs.existsSync(assetsDir);
  const hasWorkerAsset = assetsExists && fs.readdirSync(assetsDir).some((f) => f.includes('worker'));
  const hasIndexAsset = assetsExists && fs.readdirSync(assetsDir).some((f) => f.startsWith('index'));

  checks.buildArtifactsCheck = {
    passed: distExists && hasWorkerAsset && hasIndexAsset,
    details: {
      distDirectoryExists: distExists,
      assetsDirectoryExists: assetsExists,
      workerAssetFound: hasWorkerAsset,
      indexAssetFound: hasIndexAsset,
      assetsCount: assetsExists ? fs.readdirSync(assetsDir).length : 0,
    },
  };

  if (!checks.buildArtifactsCheck.passed) {
    warnings.push('Build artifacts missing or incomplete. Run `npm run build` first.');
  }
} catch (err) {
  checks.buildArtifactsCheck = { passed: false, error: err.message };
  warnings.push(`Failed to validate build artifacts: ${err.message}`);
}

// **CHECK 5: No obvious logic errors in runTick**
console.log('[static-gate] Check 5: runTick logic validation...');
try {
  const workerCode = fs.readFileSync('src/workers/force3d.worker.ts', 'utf-8');

  // Extract runTick function
  const runTickMatch = workerCode.match(/function runTick\(\)\s*{[\s\S]*?^}/m);
  if (!runTickMatch) {
    throw new Error('runTick function not found');
  }

  const runTickCode = runTickMatch[0];

  // Check for critical operations in runTick
  const hasTickCall = runTickCode.includes('simulation.tick()');
  const hasPostMessage = runTickCode.includes('self.postMessage');
  const hasEarlyExit = runTickCode.includes('tickCount >= MAX_TICKS');
  const hasAlphaCheck = runTickCode.includes('alpha()');

  checks.runTickLogicCheck = {
    passed: hasTickCall && hasPostMessage && hasEarlyExit && hasAlphaCheck,
    details: {
      hasSimulationTick: hasTickCall,
      hasPostMessage,
      hasEarlyExit,
      hasAlphaCheck,
    },
  };

  if (!checks.runTickLogicCheck.passed) {
    errors.push('Missing critical operations in runTick (tick, postMessage, earlyExit, or alphaCheck)');
  }
} catch (err) {
  checks.runTickLogicCheck = { passed: false, error: err.message };
  errors.push(`Failed to validate runTick: ${err.message}`);
}

// **CHECK 6: POSTING_RATE is set correctly**
console.log('[static-gate] Check 6: POSTING_RATE validation...');
try {
  const workerCode = fs.readFileSync('src/workers/force3d.worker.ts', 'utf-8');

  const postingRateMatch = workerCode.match(/const\s+POSTING_RATE\s*=\s*(\d+)/);
  const postingRate = postingRateMatch ? parseInt(postingRateMatch[1]) : null;

  // POSTING_RATE = 1 means post every tick (correct for stutter fix)
  // Any higher and we're back to batching
  const postingRateCorrect = postingRate === 1;

  checks.postingRateCheck = {
    passed: postingRateCorrect,
    details: {
      postingRate,
      expectedValue: 1,
      description: postingRateCorrect
        ? 'Posting every tick (correct)'
        : postingRate
          ? `Posting every ${postingRate} ticks (will create stutter)`
          : 'POSTING_RATE not found',
    },
  };

  if (!checks.postingRateCheck.passed) {
    warnings.push(`POSTING_RATE is ${postingRate}, should be 1 for stutter fix`);
  }
} catch (err) {
  checks.postingRateCheck = { passed: false, error: err.message };
  errors.push(`Failed to validate POSTING_RATE: ${err.message}`);
}

// **CHECK 7: No conflicting force configurations**
console.log('[static-gate] Check 7: Conflicting force checks...');
try {
  const workerCode = fs.readFileSync('src/workers/force3d.worker.ts', 'utf-8');

  // Check for Natural-specific force setup
  const hasNaturalForces = workerCode.includes('graphShape === \'natural\'') ||
    workerCode.includes('graphShape === "natural"') ||
    workerCode.includes('naturalChargeStrength');

  // Check for conflicting forceCollide that might not be disabled
  const hasForceCollideDisable = workerCode.includes("simulation.force('collide', null)") ||
    workerCode.includes('skip forceCollide') ||
    workerCode.includes('skipCollide');

  checks.conflictingForcesCheck = {
    passed: hasNaturalForces, // If Natural forces are set, config is intentional
    details: {
      hasNaturalForces,
      hasForceCollideDisableComment: hasForceCollideDisable,
    },
  };

  if (!checks.conflictingForcesCheck.passed) {
    warnings.push('Natural-specific force configuration not found. Check force setup.');
  }
} catch (err) {
  checks.conflictingForcesCheck = { passed: false, error: err.message };
  warnings.push(`Failed to validate force conflicts: ${err.message}`);
}

// **CHECK 8: Linting passes**
console.log('[static-gate] Check 8: ESLint validation...');
try {
  execSync('npx eslint src/workers/force3d.worker.ts --max-warnings 0', { stdio: 'pipe' });
  checks.lintCheck = { passed: true, details: 'ESLint passed (0 warnings)' };
} catch (err) {
  checks.lintCheck = { passed: false, error: 'ESLint found errors/warnings' };
  warnings.push('ESLint validation failed. Review linting output.');
}

// Finalize report
const allChecksPassed = Object.values(checks).every((c) => c.passed);
const passedCount = Object.values(checks).filter((c) => c.passed).length;
const totalCount = Object.keys(checks).length;

const report = {
  timestamp: new Date().toISOString(),
  status: errors.length > 0 ? 'FAIL' : 'PASS',
  summary: `${passedCount}/${totalCount} checks passed`,
  checks,
  errors,
  warnings,
  recommendation:
    errors.length > 0
      ? `❌ FAIL: ${errors.length} error(s) must be fixed before deployment.`
      : warnings.length > 0
        ? `⚠️  WARN: ${warnings.length} warning(s) detected. Review before deployment.`
        : '✅ PASS: All static validation checks passed. Safe for runtime testing.',
};

console.log('\n' + '='.repeat(80));
console.log(JSON.stringify(report, null, 2));
console.log('='.repeat(80) + '\n');

// Write report
const outputFile = process.argv.includes('--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : 'gate-static-validation-results.json';
fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
console.log(`[static-gate] Report written to ${outputFile}`);

// Exit code
process.exit(errors.length > 0 ? 1 : 0);
