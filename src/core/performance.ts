// Performance metrics — Core Web Vitals and navigation timing over CDP.
//
// Call Performance.enable early (ideally before page load) for accurate
// LCP/CLS/INP measurement. Returns a plain map of metric name -> value.
//
// CDP Performance.getMetrics returns metrics such as:
//   FirstContentfulPaint, LargestContentfulPaint, CumulativeLayoutShift,
//   InteractionToNextPaint, DomContentLoaded, Load, JSHeapUsedSize,
//   Timestamp, etc. Values are in milliseconds (or raw units for heap/shift).

import type { CDPConnection } from './connection.js';
import { Performance } from './types.js';
import type { Session } from './session.js';

type Conn = CDPConnection;

/** Performance metrics as a plain name -> value map. */
export interface PerformanceMetrics {
  [name: string]: number;
}

/** Enable the Performance domain and return all reported metrics. */
export async function getPerformanceMetrics(session: Session): Promise<PerformanceMetrics> {
  const conn = await session.page();
  await conn.send('Performance.enable');
  const result = await conn.send<Performance.GetMetricsResult>('Performance.getMetrics', {});
  const metrics: PerformanceMetrics = {};
  for (const m of result.metrics ?? []) {
    metrics[m.name] = m.value;
  }
  return metrics;
}
