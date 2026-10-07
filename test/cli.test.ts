// CLI driver tests: runCommand is the pure layer the commander actions adapt
// to. We drive it directly with a mocked CDP transport and assert the
// CommandResult shape (ok/data/message) that the --json printer serializes.
import { describe, it, expect, vi } from "vitest";
import {
  runCommand,
  CliContext,
  CliUsageError,
} from "../src/cli.js";

vi.mock("../src/core/connection.js", () => ({
  oneShotNavigate: vi.fn(async () => {}),
  navigate: vi.fn(async () => {}),
  captureScreenshot: vi.fn(async () => "aW1n"),
  evaluate: vi.fn(async () => ({ result: { value: 42 } })),
  createConnection: vi.fn(async () => ({
    send: vi.fn(async () => ({})),
    on: vi.fn(),
    close: vi.fn(async () => {}),
    isConnected: () => true,
    getTargetId: () => "mock",
  })),
  discoverPageTarget: vi.fn(async () => "mock-tab"),
  resolveWsUrl: vi.fn((u: string) => u),
}));

vi.mock("../src/core/session.js", () => ({
  getSession: vi.fn(async () => fakeSession()),
  closeAllSessions: vi.fn(async () => {}),
}));

vi.mock("../src/core/actions.js", async (importOriginal: any) => {
  const actual = await importOriginal();
  return {
    ...actual,
    click: vi.fn(async () => true),
    fill: vi.fn(async () => true),
    waitForSelector: vi.fn(async () => {}),
    pageText: vi.fn(async () => "Page Body Text"),
    screenshot: vi.fn(async () => "aW1uZw=="),
    fullPageScreenshot: vi.fn(async () => "aW1uZwo="),
    navigatePage: vi.fn(async () => {}),
    listTabs: vi.fn(async () => [
      { id: "t1", url: "https://example.com", title: "Example", type: "page" },
      { id: "t2", url: "https://other.test", title: "Other", type: "page" },
    ]),
  };
});

function fakeSession() {
  return {
    browserUrl: "ws://localhost:9222",
    targetId: "mock-tab",
    page: vi.fn(async () => ({
      send: vi.fn(async () => ({})),
      on: vi.fn(),
      close: vi.fn(async () => {}),
    })),
    browser: vi.fn(async () => ({
      send: vi.fn(async (m: string) =>
        m === "Target.createTarget" ? { targetId: "new-id" } : {},
      ),
    })),
    newTab: vi.fn(async () => "new-id"),
    closeTab: vi.fn(async () => {}),
    captureConsole: vi.fn(() => [
      { type: "log", text: "hello" },
      { type: "error", text: "boom" },
    ]),
    captureNetwork: vi.fn(() => [
      { requestId: "r1", method: "GET", url: "https://example.com", status: 200 },
    ]),
    closeAll: vi.fn(async () => {}),
  };
}

const ctx: CliContext = {
  browserUrl: "ws://localhost:9222",
  targetId: "mock-tab",
  json: true,
};

describe("CLI runCommand (driver)", () => {
  it("navigate returns ok + url data", async () => {
    const r = await runCommand("navigate", { _url: "https://example.com" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ url: "https://example.com" });
    expect(typeof r.message).toBe("string");
  });

  it("tabs returns a structured array (the --json shape)", async () => {
    const r = await runCommand("tabs", {}, ctx);
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.data)).toBe(true);
    expect((r.data as Array<{ id: string }>).length).toBe(2);
    // A JSON consumer can parse this straight: stable keys.
    expect(JSON.parse(JSON.stringify(r)).data[0].id).toBe("t1");
  });

  it("console returns captured entries", async () => {
    const r = await runCommand("console", {}, ctx);
    expect(r.ok).toBe(true);
    expect((r.data as Array<{ type: string }>).map((e) => e.type)).toEqual([
      "log",
      "error",
    ]);
  });

  it("new-tab delegates to the session and returns a target id", async () => {
    const r = await runCommand("new-tab", { url: "https://x.test" }, ctx);
    expect(r.ok).toBe(true);
    expect((r.data as { targetId: string }).targetId).toBe("new-id");
  });

  it("unknown command throws CliUsageError (exit code 2)", async () => {
    await expect(runCommand("nope", {}, ctx)).rejects.toThrow(CliUsageError);
  });

  it("click returns ok=true when the element is found", async () => {
    const r = await runCommand("click", { selector: ".save" }, ctx);
    expect(r.ok).toBe(true);
    expect((r.data as { clicked: boolean }).clicked).toBe(true);
  });
});
