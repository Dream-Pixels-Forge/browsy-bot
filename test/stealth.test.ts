import { describe, it, expect, vi } from "vitest";
import { enableStealth } from "../src/core/stealth.js";

function makeStealthSession() {
  const injected: Array<{ source: string }> = [];
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Page.enable") return {};
      if (method === "Page.addScriptToEvaluateOnNewDocument") {
        injected.push({ source: String(params?.source ?? "") });
        return { identifier: "stealth-1" };
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
  return { session, conn, injected };
}

describe("enableStealth", () => {
  it("injects anti-detection script on every new document", async () => {
    const { session, conn, injected } = makeStealthSession();
    await enableStealth(session);
    expect(conn.send).toHaveBeenCalledWith("Page.enable");
    expect(conn.send).toHaveBeenCalledWith("Page.addScriptToEvaluateOnNewDocument", {
      source: expect.any(String),
    });
    expect(injected.length).toBeGreaterThan(0);
    // The script should neutralize navigator.webdriver
    const sources = injected.map((i) => i.source).join("\n");
    expect(sources).toMatch(/webdriver/);
    expect(sources).toMatch(/plugins/);
    expect(sources).toMatch(/languages/);
  });

  it("does not throw when Page.enable fails", async () => {
    const { session, conn } = makeStealthSession();
    vi.mocked(conn.send).mockImplementation(async (method: string) => {
      if (method === "Page.enable") throw new Error("already enabled");
      if (method === "Page.addScriptToEvaluateOnNewDocument")
        return { identifier: "stealth-1" };
      return {};
    });
    await expect(enableStealth(session)).resolves.toBeUndefined();
  });
});
