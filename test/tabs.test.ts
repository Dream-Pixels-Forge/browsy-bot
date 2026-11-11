import { describe, it, expect, vi } from "vitest";
import { trackNewTabs, switchToTab } from "../src/core/tabs.js";

function makeTabsSession() {
  const pageTargets: Array<{ targetId: string; url: string; type: string; title?: string }> = [];
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Target.enable") return {};
      if (method === "Target.getTargets") {
        return { targetInfos: pageTargets.map((t) => ({ ...t, attached: false, canAttach: true })) };
      }
      if (method === "Target.activateTarget") return {};
      if (method === "Target.setAutoAttach") return {};
      return {};
    }),
    on: vi.fn(),
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
  return { session, conn, pageTargets };
}

describe("trackNewTabs", () => {
  it("enables Target domain and returns page targets", async () => {
    const { session, conn, pageTargets } = makeTabsSession();
    pageTargets.push(
      { targetId: "tab-1", url: "https://example.com", type: "page", title: "Example" },
      { targetId: "tab-2", url: "https://other.test", type: "page", title: "Other" },
      { targetId: "sw-1", url: "sw://x", type: "service_worker", title: "" },
    );
    const tabs = await trackNewTabs(session);
    expect(conn.send).toHaveBeenCalledWith("Target.enable");
    expect(conn.send).toHaveBeenCalledWith("Target.getTargets", {});
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toMatchObject({ targetId: "tab-1", url: "https://example.com" });
    expect(tabs[1]).toMatchObject({ targetId: "tab-2", url: "https://other.test" });
  });

  it("registers a Target.targetCreated event handler", async () => {
    const { session, conn } = makeTabsSession();
    await trackNewTabs(session);
    expect(conn.on).toHaveBeenCalledWith("Target.targetCreated", expect.any(Function));
  });
});

describe("switchToTab", () => {
  it("calls Target.activateTarget on the browser connection", async () => {
    const { session, conn } = makeTabsSession();
    await switchToTab(session, "tab-42");
    expect(conn.send).toHaveBeenCalledWith("Target.activateTarget", { targetId: "tab-42" });
    expect(conn.send).toHaveBeenCalledWith("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
  });
});
