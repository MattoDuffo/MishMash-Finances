/**
 * Retirement projection with a Monte Carlo simulation, in today's money:
 * returns are converted to real (after-inflation) returns, so every figure
 * is comparable to prices now.
 */
import type { Minor, RetirementInputs } from './types';

/** Small seeded RNG so results are stable between renders. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export interface Projection {
  ages: number[];
  p10: Minor[];
  p50: Minor[];
  p90: Minor[];
  successRate: number; // share of runs that never ran out of money
  fiNumber: Minor; // 25x spending (4% rule)
  medianAtRetirement: Minor;
  depletionAgeMedian: number | null;
}

export function projectRetirement(inp: RetirementInputs, start: Minor, runs = 1000, seed = 42): Projection {
  const rand = mulberry32(seed);
  const realMean = (1 + inp.expectedReturn / 100) / (1 + inp.inflation / 100) - 1;
  const vol = inp.volatility / 100;
  const years = Math.max(1, inp.endAge - inp.currentAge);
  const paths: number[][] = [];
  let successes = 0;
  for (let r = 0; r < runs; r++) {
    let bal = start;
    const path = [bal];
    let failed = false;
    for (let y = 1; y <= years; y++) {
      const age = inp.currentAge + y;
      const ret = realMean + vol * normal(rand);
      bal = bal * (1 + ret);
      bal += age <= inp.retireAge ? inp.monthlyContribution * 12 : -inp.annualSpending;
      if (bal < 0) {
        bal = 0;
        failed = true;
      }
      path.push(bal);
    }
    if (!failed) successes++;
    paths.push(path);
  }
  const ages = Array.from({ length: years + 1 }, (_, i) => inp.currentAge + i);
  const pct = (i: number, p: number) => {
    const col = paths.map((pp) => pp[i]).sort((a, b) => a - b);
    return Math.round(col[Math.min(col.length - 1, Math.floor(p * col.length))]);
  };
  const p50 = ages.map((_, i) => pct(i, 0.5));
  const depletion = p50.findIndex((v, i) => i > 0 && ages[i] > inp.retireAge && v <= 0);
  return {
    ages,
    p10: ages.map((_, i) => pct(i, 0.1)),
    p50,
    p90: ages.map((_, i) => pct(i, 0.9)),
    successRate: successes / runs,
    fiNumber: inp.annualSpending * 25,
    medianAtRetirement: p50[Math.max(0, Math.min(years, inp.retireAge - inp.currentAge))],
    depletionAgeMedian: depletion >= 0 ? ages[depletion] : null,
  };
}
