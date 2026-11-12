# GOAL-BROWSY-V070

## Goal: v0.7.0 — Performance metrics & error budget

### Objective
Give browsy-bot performance measurement: Core Web Vitals (LCP, CLS, INP),
navigation/resource timing, and a console error budget that can fail CI.

### Context
browsy-bot can drive, capture, and validate UI, but it has no performance
surface. v0.7.0 adds performance metrics so teams can use browsy-bot for
performance regression detection alongside visual regression.

### Deliverables
- [ ] src/core/performance.ts — getPerformanceMetrics(session)
- [ ] src/core/perf-budget.ts — checkPerformanceBudget(metrics, budget)
- [ ] src/core/actions.ts — re-export getPerformanceMetrics
- [ ] src/mcp.ts — browsy_performance tool
- [ ] src/cli.ts — browsy performance command
- [ ] Tests: test/performance.test.ts, test/perf-budget.test.ts,
      browsy_performance in mcp.test.ts
- Done when: npm run typecheck && npm run build && npm test all green
