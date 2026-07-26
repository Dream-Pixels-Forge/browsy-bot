// Real integration test against a live Chrome/Chromium CDP endpoint.
// Skips automatically when CDP is unreachable (no Chrome running).
//
// Run separately from the mocked unit tests so the `ws` mock in
// connection.test.ts does not leak into this file:
//   npx vitest run test/integration.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import {
  navigate,
  captureScreenshot,
  evaluate,
  createConnection,
} from "../src/connection.js";
import { createBrowsy } from "../src/index.js";
import * as http from "http";

const CDP_URL = process.env.BROWSY_URL ?? "ws://localhost:9222";
const TEST_URL = "https://example.com";

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

let cdpAvailable = false;

beforeAll(async () => {
  try {
    const body = await httpGet("http://localhost:9222/json/version");
    cdpAvailable = body.includes("Protocol-Version");
  } catch {
    cdpAvailable = false;
  }
}, 10000);

// Runtime skip: vitest evaluates `it.skip`/`it` at registration time,
// before `beforeAll` runs. So we register every test as a real `it` and
// skip *inside* the test body when CDP is not available.
function cdpTest(name: string, fn: () => Promise<void>, timeout = 15000) {
  it(name, async () => {
    if (!cdpAvailable) return; // silently skip
    await fn();
  }, timeout);
}

describe("real CDP integration", () => {
  cdpTest("createConnection auto-discovers a page target", async () => {
    const conn = await createConnection(CDP_URL);
    expect(conn.isConnected()).toBe(true);
    expect(conn.getUrl()).toContain("/devtools/page/");
    await conn.close();
  });

  cdpTest("navigate to a real page", async () => {
    await navigate(CDP_URL, TEST_URL);
  });

  cdpTest("captureScreenshot returns real base64 PNG data", async () => {
    // Navigate first so the page is loaded, then screenshot on the same
    // auto-discovered target.
    await navigate(CDP_URL, TEST_URL);
    // Small delay to let the page settle after navigation.
    await new Promise((r) => setTimeout(r, 500));
    const data = await captureScreenshot(CDP_URL, { format: "png" });
    expect(typeof data).toBe("string");
    expect(data.length).toBeGreaterThan(100);
    const buf = Buffer.from(data.slice(0, 100), "base64");
    // PNG magic bytes: 0x89 0x50 0x4E 0x47
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });

  cdpTest("evaluate returns the document title from a real page", async () => {
    await navigate(CDP_URL, TEST_URL);
    const result = (await evaluate(CDP_URL, "document.title")) as any;
    const title = result?.result?.value ?? result?.result?.description;
    expect(String(title)).toContain("Example");
  });

  cdpTest(
    "Browsy class connect + all domains work + close",
    async () => {
      const browsy = createBrowsy(CDP_URL);
      expect(browsy.isConnected).toBe(false);

      await browsy.connect();
      expect(browsy.isConnected).toBe(true);

      const screenshot = await browsy.page.captureScreenshot({ format: "png" });
      expect(screenshot.data.length).toBeGreaterThan(100);

      await browsy.performance.enable();
      const metrics = await browsy.performance.getMetrics();
      expect(Array.isArray(metrics.metrics)).toBe(true);

      const axTree = await browsy.accessibility.getFullAXTree();
      expect(Array.isArray(axTree.nodes)).toBe(true);

      await browsy.close();
      expect(browsy.isConnected).toBe(false);
    },
    20000,
  );

  cdpTest("evaluate rejects on invalid JavaScript expression", async () => {
    await expect(evaluate(CDP_URL, "syntax error !!!")).rejects.toThrow();
  });
});