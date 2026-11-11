import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  captureBaseline,
  compareScreenshot,
} from "../src/core/visual.js";

const tmpBase = path.join(os.tmpdir(), "browsy-visual-test");
afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

function makeVisualSession() {
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Page.getLayoutMetrics") {
        return {
          contentSize: { width: 100, height: 100 },
          layoutSize: { width: 100, height: 100 },
          visibleSize: { width: 100, height: 100 },
          visualViewport: { pageX: 0, pageY: 0, scale: 1, width: 100, height: 100, offsetX: 0, offsetY: 0 },
        };
      }
      if (method === "Page.captureScreenshot") {
        return { data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" };
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

describe("captureBaseline", () => {
  it("captures a screenshot and saves it to baselines dir", async () => {
    const { session } = makeVisualSession();
    const baselineDir = path.join(tmpBase, "baselines");
    const out = await captureBaseline(session, "homepage", { baselineDir });
    expect(out).toContain("baselines");
    expect(out).toContain("homepage");
    expect(out).toMatch(/\.png$/);
    expect(fs.existsSync(out)).toBe(true);
    const content = fs.readFileSync(out);
    expect(content.length).toBeGreaterThan(0);
  });
});

describe("compareScreenshot", () => {
  it("passes when baseline and current match", async () => {
    const { session } = makeVisualSession();
    const baselineDir = path.join(tmpBase, "baselines");
    const diffDir = path.join(tmpBase, "diffs");
    fs.mkdirSync(baselineDir, { recursive: true });
    fs.mkdirSync(diffDir, { recursive: true });

    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    fs.writeFileSync(path.join(baselineDir, "homepage.png"), Buffer.from(png, "base64"));

    const result = await compareScreenshot(session, "homepage", {
      baselineDir,
      diffDir,
      threshold: 0,
    });
    expect(result.pass).toBe(true);
    expect(result.diffPath).toContain("diffs");
    expect(result.totalPixels).toBe(1);
    expect(result.diffPixels).toBe(0);
  });

  it("fails when baseline is missing", async () => {
    const { session } = makeVisualSession();
    const baselineDir = path.join(tmpBase, "baselines");
    const diffDir = path.join(tmpBase, "diffs");
    fs.mkdirSync(baselineDir, { recursive: true });
    fs.mkdirSync(diffDir, { recursive: true });

    const result = await compareScreenshot(session, "nonexistent", {
      baselineDir,
      diffDir,
      threshold: 0,
    });
    expect(result.pass).toBe(false);
  });
});
