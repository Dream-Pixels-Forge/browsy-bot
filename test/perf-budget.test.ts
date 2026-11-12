import { describe, it, expect } from "vitest";
import { checkPerformanceBudget } from "../src/core/perf-budget.js";

interface Budget {
  [metric: string]: number; // max allowed value
}

describe("checkPerformanceBudget", () => {
  it("passes when all metrics are within budget", () => {
    const metrics = {
      LargestContentfulPaint: 2000,
      CumulativeLayoutShift: 0.1,
      InteractionToNextPaint: 200,
      FirstContentfulPaint: 1000,
    };
    const budget: Budget = {
      LargestContentfulPaint: 2500,
      CumulativeLayoutShift: 0.1,
      InteractionToNextPaint: 300,
    };
    const result = checkPerformanceBudget(metrics, budget);
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("fails when a metric exceeds budget", () => {
    const metrics = {
      LargestContentfulPaint: 4000,
      CumulativeLayoutShift: 0.3,
    };
    const budget: Budget = {
      LargestContentfulPaint: 2500,
      CumulativeLayoutShift: 0.1,
    };
    const result = checkPerformanceBudget(metrics, budget);
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]).toMatchObject({
      metric: "LargestContentfulPaint",
      actual: 4000,
      threshold: 2500,
    });
  });

  it("ignores metrics not in the budget", () => {
    const metrics = {
      LargestContentfulPaint: 9999,
      SomeUnknownMetric: 5000,
    };
    const budget: Budget = {
      LargestContentfulPaint: 100,
    };
    const result = checkPerformanceBudget(metrics, budget);
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].metric).toBe("LargestContentfulPaint");
  });

  it("passes with empty metrics", () => {
    const result = checkPerformanceBudget({}, { LargestContentfulPaint: 100 });
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
