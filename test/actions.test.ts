// Unit tests for the core actions layer. The CDP transport is faked
// (a method-aware fake connection); the real action logic runs.
import { describe, it, expect, vi } from "vitest";
import {
  click,
  fill,
  waitForSelector,
  pageText,
  pageTitle,
  currentUrl,
  screenshot,
  fullPageScreenshot,
  navigatePage,
  listTabs,
  newTab,
  closeTab,
} from "../src/core/actions.js";

// actions.js imports listTargets from connection.js for the listTabs action.
// Override just that; keep the rest real.
vi.mock("../src/core/connection.js", async (importOriginal: any) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listTargets: vi.fn(async () => [
      { id: "tab-1", type: "page", url: "https://example.com/", title: "Example" },
    ]),
  };
});

function makeSession() {
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      switch (method) {
        case "Page.navigate":
          return { frameId: "f1", loaderId: "l1" };
        case "Page.captureScreenshot":
          return { data: "aW1n" };
        case "Page.getLayoutMetrics":
          return {
            contentSize: { width: 800, height: 1200 },
            layoutSize: { width: 800, height: 1200 },
            visibleSize: { width: 800, height: 600 },
            visualViewport: {
              pageX: 0,
              pageY: 0,
              scale: 1,
              width: 800,
              height: 600,
              offsetX: 0,
              offsetY: 0,
            },
          };
        case "Runtime.evaluate": {
          const expr = params?.expression ?? "";
          if (expr.includes("? '1' : '0'") || expr.startsWith("document.querySelector"))
            return { result: { value: "1" } };
          if (expr.startsWith("document.body")) return { result: { value: "Hello World" } };
          if (expr.startsWith("document.title")) return { result: { value: "Example" } };
          if (expr.startsWith("location.href")) return { result: { value: "https://example.com/" } };
          if (expr.includes("el.click()"))
            return { result: { value: '{"clicked":true,"tag":"BUTTON"}' } };
          if (expr.includes("el.value ="))
            return { result: { value: '{"filled":true,"tag":"INPUT"}' } };
          return { result: { value: "1" } };
        }
        default:
          return {};
      }
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
    newTab: vi.fn(async () => "new-tab-id"),
    closeTab: vi.fn(async () => {}),
    captureConsole: () => [{ type: "log", text: "hi" }],
    captureNetwork: () => [
      { requestId: "r1", method: "GET", url: "https://example.com/", status: 200 },
    ],
    closeAll: vi.fn(async () => {}),
  };
  return { session, conn };
}

// A session whose querySelector always reports "not found" (for the wait timeout test).
function makeAbsentSession() {
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Runtime.evaluate") return { result: { value: "0" } };
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
  };
  return session;
}

describe("core actions", () => {
  it("click resolves true when the element is found", async () => {
    const { session } = makeSession();
    await expect(click(session, ".save")).resolves.toBe(true);
  });

  it("fill resolves true when the element is found", async () => {
    const { session } = makeSession();
    await expect(fill(session, "#email", "a@b.c")).resolves.toBe(true);
  });

  it("waitForSelector resolves when the element is present", async () => {
    const { session } = makeSession();
    await expect(
      waitForSelector(session, "#ready", { intervalMs: 10, timeoutMs: 500 }),
    ).resolves.toBeUndefined();
  });

  it("waitForSelector throws on timeout when the element is absent", async () => {
    const session = makeAbsentSession();
    await expect(
      waitForSelector(session, "#never", { intervalMs: 10, timeoutMs: 40 }),
    ).rejects.toThrow(/waitForSelector timed out/);
  });

  it("pageText returns the trimmed visible text", async () => {
    const { session } = makeSession();
    await expect(pageText(session)).resolves.toBe("Hello World");
  });

  it("pageTitle returns the document title", async () => {
    const { session } = makeSession();
    await expect(pageTitle(session)).resolves.toBe("Example");
  });

  it("currentUrl returns location.href", async () => {
    const { session } = makeSession();
    await expect(currentUrl(session)).resolves.toBe("https://example.com/");
  });

  it("screenshot returns the base64 payload", async () => {
    const { session } = makeSession();
    await expect(screenshot(session)).resolves.toBe("aW1n");
  });

  it("fullPageScreenshot captures with a content-size clip", async () => {
    const { session, conn } = makeSession();
    const data = await fullPageScreenshot(session);
    expect(data).toBe("aW1n");
    // The last captureScreenshot call used a clip equal to the content size.
    const clipCall = conn.send.mock.calls.find(
      (c) => c[0] === "Page.captureScreenshot",
    );
    expect(clipCall[1].clip).toMatchObject({ width: 800, height: 1200 });
    expect(clipCall[1].captureBeyondViewport).toBe(true);
  });

  it("navigatePage sends Page.navigate", async () => {
    const { session, conn } = makeSession();
    await navigatePage(session, "https://example.com/");
    expect(conn.send).toHaveBeenCalledWith(
      "Page.navigate",
      { url: "https://example.com/" },
    );
  });

  it("listTabs filters to page targets via the HTTP /json/list", async () => {
    const { session } = makeSession();
    const tabs = await listTabs(session);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ id: "tab-1", url: "https://example.com/" });
  });

  it("newTab and closeTab delegate to the session", async () => {
    const { session } = makeSession();
    await expect(newTab(session, "https://x.test")).resolves.toBe("new-tab-id");
    await closeTab(session, "tab-1");
    expect(session.closeTab).toHaveBeenCalledWith("tab-1");
  });
});
