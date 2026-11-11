import { describe, it, expect, vi } from "vitest";
import { setRequestInterception } from "../src/core/intercept.js";

function makeInterceptSession() {
  const paused: Array<{ requestId: string; url: string; method: string }> = [];
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Network.enable") return {};
      if (method === "Network.setBlockedURLs") return {};
      if (method === "Fetch.enable") return {};
      if (method === "Fetch.fulfillRequest") return {};
      if (method === "Fetch.failRequest") return {};
      return {};
    }),
    on: vi.fn((event: string, cb: (data: any) => void) => {
      if (event === "Fetch.requestPaused") {
        // queue a fake paused request to be triggered manually
        (cb as any)._queued = paused;
      }
    }),
    close: vi.fn(async () => {}),
    isConnected: () => true,
    getTargetId: () => "t1",
  };

  const session: any = {
    browserUrl: "ws://localhost:9222",
    targetId: "t1",
    page: vi.fn(async () => conn),
    browser: vi.fn(async () => conn),
  };
  return { session, conn, paused };
}

describe("setRequestInterception", () => {
  it("enables Fetch and Network domains and sets blocked URLs", async () => {
    const { session, conn } = makeInterceptSession();
    await setRequestInterception(session, [
      { urlPattern: "*://*.example.com/*", action: "block" },
    ]);
    expect(conn.send).toHaveBeenCalledWith("Network.enable");
    expect(conn.send).toHaveBeenCalledWith("Fetch.enable");
    expect(conn.send).toHaveBeenCalledWith("Network.setBlockedURLs", {
      urls: ["*://*.example.com/*"],
    });
  });

  it("handles mock action by fulfilling the paused request", async () => {
    const { session, conn, paused } = makeInterceptSession();
    let pausedHandler: any;
    vi.mocked(conn.on).mockImplementation((event: string, cb: any) => {
      if (event === "Fetch.requestPaused") pausedHandler = cb;
    });

    await setRequestInterception(session, [
      {
        urlPattern: "*://api.example.com/*",
        action: "mock",
        response: { status: 200, body: JSON.stringify({ ok: true }), headers: {} },
      },
    ]);

    // Simulate a paused request
    pausedHandler({
      params: {
        requestId: "req-1",
        url: "https://api.example.com/data",
        method: "GET",
      },
    });

    expect(conn.send).toHaveBeenCalledWith(
      "Fetch.fulfillRequest",
      expect.objectContaining({
        requestId: "req-1",
        responseCode: 200,
        body: expect.any(String),
      })
    );
  });
});
