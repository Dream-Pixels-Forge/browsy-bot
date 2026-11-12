import { describe, it, expect, vi } from "vitest";
import { getPerformanceMetrics } from "../src/core/performance.js";

function makePerfSession() {
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Performance.enable") return {};
      if (method === "Performance.getMetrics") {
        return {
          metrics: [
            { name: "FirstContentfulPaint", value: 1200 },
            { name: "LargestContentfulPaint", value: 2400 },
            { name: "CumulativeLayoutShift", value: 0.05 },
            { name: "InteractionToNextPaint", value: 80 },
            { name: "DomContentLoaded", value: 1100 },
            { name: "Load", value: 1500 },
            { name: "JSHeapUsedSize", value: 15_000_000 },
            { name: "Timestamp", value: 1_700_000_000_000 },
          ],
        };
      }
      return {};
    }),
    close: vi.fn(async () => {}),
    isConnected: () => true,
    getTargetId: () => "t1",
  };

  const session: any = {
    browserUrl: "ws://localhost:9222",
    targetId: "t1",
    page: vi.fn(async () => conn),
  };
  return { session, conn };
}

describe("getPerformanceMetrics", () => {
  it("enables Performance and returns metrics map", async () => {
    const { session, conn } = makePerfSession();
    const metrics = await getPerformanceMetrics(session);
    expect(conn.send).toHaveBeenCalledWith("Performance.enable");
    expect(conn.send).toHaveBeenCalledWith("Performance.getMetrics", {});
    expect(metrics.FirstContentfulPaint).toBe(1200);
    expect(metrics.LargestContentfulPaint).toBe(2400);
    expect(metrics.CumulativeLayoutShift).toBe(0.05);
    expect(metrics.InteractionToNextPaint).toBe(80);
    expect(metrics.DomContentLoaded).toBe(1100);
    expect(metrics.Load).toBe(1500);
    expect(metrics.JSHeapUsedSize).toBe(15_000_000);
  });

  it("returns empty object when no metrics are reported", async () => {
    const { session, conn } = makePerfSession();
    vi.mocked(conn.send).mockImplementation(async (method: string) => {
      if (method === "Performance.enable") return {};
      if (method === "Performance.getMetrics") return { metrics: [] };
      return {};
    });
    const metrics = await getPerformanceMetrics(session);
    expect(metrics).toEqual({});
  });
});
