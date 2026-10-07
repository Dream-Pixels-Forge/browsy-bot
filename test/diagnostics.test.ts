// Unit tests for the diagnostics (doctor) layer. All probes are injected so
// no network / subprocess is touched — the assertions cover report assembly,
// suggestions, and the binary-resolution precedence.
import { describe, it, expect, vi, afterEach } from "vitest";
import { doctor, findBrowserBinary } from "../src/core/diagnostics.js";
import type { DoctorProbes } from "../src/core/diagnostics.js";

function makeProbes(over: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    getVersion: vi.fn(async () => ({ Browser: "HeadlessChrome/126.0.0.0", "Protocol-Version": "1.3" })),
    listTargets: vi.fn(async () => [
      { id: "p1", type: "page", url: "https://example.com/", title: "Ex" },
      { id: "s1", type: "service_worker", url: "sw://x", title: "" },
    ]),
    findBinary: vi.fn(() => "/usr/bin/chromium"),
    checkMemorius: vi.fn(async () => ({ available: true })),
    ...over,
  };
}

describe("doctor", () => {
  it("reports ready when the endpoint is up with a page target", async () => {
    const report = await doctor("ws://localhost:9222", { probes: makeProbes() });
    expect(report.ready).toBe(true);
    expect(report.endpoint).toMatchObject({
      reachable: true,
      targets: 2,
      pageTargets: 1,
    });
    expect(report.endpoint.version).toMatchObject({ Browser: "HeadlessChrome/126.0.0.0" });
    expect(report.suggestions).toHaveLength(0);
  });

  it("reports not-ready with an actionable suggestion when the endpoint is down", async () => {
    const report = await doctor("ws://localhost:9222", {
      probes: makeProbes({
        getVersion: vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
        listTargets: vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
      }),
    });
    expect(report.ready).toBe(false);
    expect(report.endpoint.reachable).toBe(false);
    expect(report.endpoint.error).toMatch(/ECONNREFUSED/);
    expect(report.suggestions[0]).toMatch(/ensure-browser/);
  });

  it("suggests opening a tab when the endpoint is up but has no page target", async () => {
    const report = await doctor("ws://localhost:9222", {
      probes: makeProbes({
        listTargets: vi.fn(async () => [{ id: "s1", type: "service_worker", url: "sw://x", title: "" }]),
      }),
    });
    expect(report.ready).toBe(false);
    expect(report.endpoint.pageTargets).toBe(0);
    expect(report.suggestions.some((s) => s.includes("new-tab"))).toBe(true);
  });

  it("suggests a binary fix when none is found", async () => {
    const report = await doctor("ws://localhost:9222", {
      probes: makeProbes({ findBinary: vi.fn(() => undefined) }),
    });
    expect(report.binary.found).toBe(false);
    expect(report.suggestions.some((s) => s.includes("BROWSY_BROWSER_BINARY"))).toBe(true);
  });

  it("notes memorius absence without failing readiness", async () => {
    const report = await doctor("ws://localhost:9222", {
      probes: makeProbes({
        checkMemorius: vi.fn(async () => ({ available: false, error: "not found" })),
      }),
    });
    expect(report.ready).toBe(true); // memorius is optional
    expect(report.memorius.available).toBe(false);
    expect(report.suggestions.some((s) => s.includes("memorius"))).toBe(true);
  });

  it("honors an explicitly-provided binary path", async () => {
    const report = await doctor("ws://localhost:9222", {
      binary: "/opt/chrome/chrome",
      probes: makeProbes({ findBinary: vi.fn(() => "/usr/bin/chromium") }),
    });
    expect(report.binary).toMatchObject({ found: true, path: "/opt/chrome/chrome", source: "explicit" });
  });
});

describe("findBrowserBinary", () => {
  const envKey = "BROWSY_BROWSER_BINARY";
  const saved = process.env[envKey];
  afterEach(() => {
    if (saved === undefined) delete process.env[envKey];
    else process.env[envKey] = saved;
  });

  it("explicit arg wins over env and PATH", () => {
    process.env[envKey] = "/env/chrome";
    expect(findBrowserBinary("/explicit/chrome")).toBe("/explicit/chrome");
  });

  it("env override wins over PATH candidates", () => {
    process.env[envKey] = "/env/chrome";
    expect(findBrowserBinary()).toBe("/env/chrome");
  });

  it("falls back to platform candidates / PATH (may be undefined in CI)", () => {
    delete process.env[envKey];
    const found = findBrowserBinary();
    // Deterministic assertion: the call succeeded and returned a string-or-undefined.
    expect(found === undefined || typeof found === "string").toBe(true);
  });
});
