# Correctness Gate Framework

Three-layer validation to ensure performance fixes don't break the graph.

## Gates Overview

### **Gate 1: Static Validation** (`gate-static-validation.mjs`)
**When:** Before runtime testing  
**What:** Checks source code + build artifacts  
**Runtime:** ~2 seconds

**Checks:**
1. Force parameters (theta, alphaDecay, etc.) in valid ranges
2. No TypeScript/syntax errors
3. Critical force functions present
4. Build artifacts exist and are valid
5. runTick() has all required operations
6. POSTING_RATE is set to 1 (for stutter fix)
7. No conflicting force configurations
8. ESLint passes with 0 warnings

**Exit codes:**
- `0` = PASS (safe for runtime testing)
- `1` = FAIL (fix issues before deploying)

**Example run:**
```bash
node scripts/gate-static-validation.mjs
```

### **Gate 2: Runtime Correctness** (`gate-correctness.mjs`)
**When:** After build, before deployment  
**What:** Runs Puppeteer against live UI  
**Runtime:** ~50 seconds

**Checks:**
1. Canvas renders (graph is visible)
2. Natural shape button is clickable
3. No console errors during settling
4. Simulation converges (doesn't loop forever)
5. Node separation is valid (no WebGL errors)
6. Graph connectivity is intact
7. Force parameters are in valid ranges
8. Layout is stable (no oscillation)

**Exit codes:**
- `0` = PASS (safe to deploy)
- `1` = FAIL (layout is broken)
- `2` = Error (runtime issue)

**Example run:**
```bash
npm run dev &
sleep 5
node scripts/gate-correctness.mjs

# With headless browser visible:
node scripts/gate-correctness.mjs --headless false
```

### **Gate 3: Master Gate** (`gate-all.mjs`)
**When:** Before committing fixes  
**What:** Chains all gates in order  
**Runtime:** ~70 seconds total

**Phases:**
1. Static validation
2. Build (tsc + vite)
3. Dev server startup
4. Runtime correctness
5. Combined report

**Exit codes:**
- `0` = All gates passed, safe to deploy
- `1` = One or more gates failed
- `2` = Fatal error (setup issue)

**Example run:**
```bash
npm run gate
```

## Integration with Autoresearch Loop

**Typical workflow:**

```bash
# 1. Baseline benchmark (before fix)
node scripts/benchmark-stutter.mjs --output baseline.json
# Output: stutterRatio: 0.35, medianWorkerTickMs: 350

# 2. Apply Phase 1 fix to force3d.worker.ts
# Edit: .theta(0.95) and .distanceMax(spread * 220)

# 3. Run static gate (catch issues early)
node scripts/gate-static-validation.mjs
# Output: All checks passed ✅

# 4. Build and run all gates
npm run gate
# Output: ✅ ALL GATES PASSED

# 5. After-fix benchmark
node scripts/benchmark-stutter.mjs --output phase1.json
# Output: stutterRatio: 0.12, medianWorkerTickMs: 175

# 6. Compare
jq '.summary' baseline.json phase1.json
# Stutter reduced from 35% to 12% ✅

# 7. If improved, commit
git add src/workers/force3d.worker.ts
git commit -m "fix(perf): optimize natural layout forces (theta + distanceMax)"
```

## CI/CD Integration

Add to GitHub Actions:

```yaml
name: Correctness Gates

on: [push, pull_request]

jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install dependencies
        run: npm ci
      
      - name: Static validation gate
        run: node scripts/gate-static-validation.mjs
      
      - name: Build
        run: npm run build
      
      - name: Benchmark baseline
        run: node scripts/benchmark-stutter.mjs --output baseline.json
      
      - name: Runtime correctness gate
        run: |
          npm run dev &
          sleep 10
          node scripts/gate-correctness.mjs
      
      - name: Fail if stutter >20%
        run: |
          stutter=$(jq '.summary.stutterRatio' baseline.json)
          if (( $(echo "$stutter > 0.20" | bc -l) )); then
            echo "❌ Stutter regression: $stutter"
            exit 1
          fi
```

## What Each Gate Prevents

| Issue | Caught By |
|-------|-----------|
| Typos in force parameters | Static (Check 1) |
| TypeScript compilation errors | Static (Check 2) |
| Missing force functions | Static (Check 3) |
| Stale build artifacts | Static (Check 4) |
| runTick logic broken | Static (Check 5) |
| Reverted stutter fix (POSTING_RATE != 1) | Static (Check 6) |
| Conflicting forces | Static (Check 7) |
| Code style issues | Static (Check 8) |
| Graph fails to render | Runtime (Check 1) |
| Natural shape unavailable | Runtime (Check 2) |
| Console errors during settling | Runtime (Check 3) |
| Infinite loop / no convergence | Runtime (Check 4) |
| Node overlap / visual corruption | Runtime (Check 5) |
| Disconnected components | Runtime (Check 6) |
| Force param drift over time | Runtime (Check 7) |
| Oscillatory instability | Runtime (Check 8) |

## Troubleshooting

### Static gate fails: "Force parameters out of range"
**Solution:** Check `force3d.worker.ts` for theta, alphaDecay, velocityDecay, MAX_TICKS values. See valid ranges in Static Check 1.

### Static gate fails: "TypeScript compilation failed"
**Solution:** Run `npm run build` locally to see full error, fix type issues.

### Runtime gate fails: "Canvas not found"
**Solution:** Dev server may not have started. Check `/tmp/gate-vite.log` and `/tmp/gate-api.log` for errors.

### Runtime gate fails: "Simulation did not converge"
**Solution:** Check if force parameters are too aggressive. Increase `alphaDecay` or reduce charge strength.

### Runtime gate fails: "Node overlap detected"
**Solution:** Re-enable `forceCollide()` or increase its strength parameter. May need to revert performance optimization.

## Expected Pass Criteria

**Static gate:**
- All 8 checks pass
- No errors (warnings OK)

**Runtime gate:**
- At least 6/8 checks pass
- No CRITICAL failures (canvas render, shape selection)
- Warnings only (no failures)

**Master gate (gate-all):**
- Static + build + runtime all pass
- Overall status: PASS
- Ready to commit/deploy

## Next Steps

After implementing Phase 1 fix and all gates pass, measure performance improvement using `benchmark-stutter.mjs` and decide if Phase 2 (WASM) or Phase 3 (parallelization) is needed.
