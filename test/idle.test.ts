import { describe, it, expect, vi } from "vitest";
import { waitForNetworkIdle } from "../src/core/idle.js";

function makeIdleSession() {
  const handlers = new Map<string, (data: any) => void>();
  const conn = {
    send: vi.fn(async (method: string) => {
      if (method === "Network.enable") return {};
      return {};
    }),
    on: vi.fn((event: string, cb: (data: any) => void) => {
      handlers.set(event, cb);
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
  return { session, conn, handlers };
}

describe("waitForNetworkIdle", () => {
  it("resolves when no requests are in flight for idleMs", async () => {
    const { session, conn, handlers } = makeIdleSession();
    const promise = waitForNetworkIdle(session, { idleMs: 20, timeoutMs: 1000 });

    // let the async function register its event handlers
    await new Promise((r) => setTimeout(r, 0));

    // send a request, then respond to it
    handlers.get("Network.requestWillBeSent")!({
      params: { requestId: "r1", type: "XHR" },
    });
    handlers.get("Network.responseReceived")!({
      params: { requestId: "r1", response: { status: 200 } },
    });

    await expect(promise).resolves.toBeUndefined();
    expect(conn.send).toHaveBeenCalledWith("Network.enable");
  });

  it("throws on timeout if network never idles", async () => {
    const { session, handlers } = makeIdleSession();
    const promise = waitForNetworkIdle(session, { idleMs: 50, timeoutMs: 100 });
    // keep sending requests so network never idles long enough
    let i = 0;
    const interval = setInterval(() => {
      handlers.get("Network.requestWillBeSent")!({
        params: { requestId: `r${++i}`, type: "XHR" },
      });
    }, 20);
    await expect(promise).rejects.toThrow(/timed out/);
    clearInterval(interval);
  });
});
