// Performance budget — compare measured metrics against thresholds.
//
// Returns { pass, violations } where each violation names the metric, the
// measured value, and the budget threshold. Metrics not present in the
// budget are ignored; missing metrics are treated as passing.

export interface BudgetViolation {
  metric: string;
  actual: number;
  threshold: number;
}

export interface BudgetResult {
  pass: boolean;
  violations: BudgetViolation[];
}

/** Compare `metrics` against `budget` (metric -> max allowed value). */
export function checkPerformanceBudget(
  metrics: Record<string, number>,
  budget: Record<string, number>,
): BudgetResult {
  const violations: BudgetViolation[] = [];
  for (const [metric, threshold] of Object.entries(budget)) {
    const actual = metrics[metric];
    if (actual === undefined) continue; // not measured — skip
    if (actual > threshold) {
      violations.push({ metric, actual, threshold });
    }
  }
  return { pass: violations.length === 0, violations };
}
