# exp_0021 Results

## Iteration 5 — GATE PASS ✓
- AD=0.055 (baseline), ALPHA_MIN=0.001
- Charges: -120/-200/-350 (3x stronger regular, 1.67x super, 1.75x ultra vs baseline)
- Ticks: 88
- Score: 73/100 (GOOD)
- Key finding: **Strong charges compensate for standard decay, better shape than fast-decay weak-charge approach**

## Iterations 1-4 — FAILURES
1. AD=0.15, ALPHA_MIN=0.10, charges -60/-120/-200: Score 54/100, high core density
2. AD=0.15, ALPHA_MIN=0.10, charges -120/-200/-350: Score 53/100
3. AD=0.13, ALPHA_MIN=0.10, charges -120/-200/-350: Score 52/100
4. AD=0.15, ALPHA_MIN=0.05, charges -120/-200/-350: Score 53/100

All fast-decay (AD>0.13) strategies failed regardless of ALPHA_MIN, suggesting core density is the critical failure mode at early ticks.
