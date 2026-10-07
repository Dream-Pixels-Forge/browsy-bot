// OpenCode plugin test — registers all browsy tools via a mocked
// @opencode-ai/plugin module and proves the 4 original tools keep their
// pre-refactor semantics. installSkill is disabled so nothing is written
// to the real ~/.config/opencode tree.
import { describe, it, expect, vi } from "vitest";

// Minimal zod-shape mock: tool.schema.string()/number() return chainable
// objects with .optional()/.describe()/.int().
vi.mock("@opencode-ai/plugin", () => {
  const chain = () => {
    const base: any = {};
    base.optional = () => base;
    base.describe = () => base;
    base.int = () => base;
    return base;
  };
  const schema = { string: () => chain(), number: () => chain() };
  const tool: any = (def: any) => def;
  tool.schema = schema;
  return { tool, default: tool, Plugin: null };
});

vi.mock("../src/core/connection.js", () => ({
  navigate: vi.fn(async (_url: string, _u: string, _t?: string) => {}),
  captureScreenshot: vi.fn(async () => "aW1u"),
  evaluate: vi.fn(async () => ({ result: { value: "Example" } })),
}));

vi.mock("../src/core/session.js", () => ({
  getSession: vi.fn(async () => fakeSession()),
  closeAllSessions: vi.fn(async () => {}),
}));

vi.mock("../src/core/actions.js", () => ({
  waitForSelector: vi.fn(async () => {}),
  navigatePage: vi.fn(async () => {}),
  listTabs: vi.fn(async () => []),
}));

vi.mock("../src/memorius.js", () => ({
  remember: vi.fn(async () => true),
  recall: vi.fn(async () => ({ available: false, raw: "" })),
}));

function fakeSession(): any {
  return {
    browserUrl: "ws://localhost:9222",
    targetId: "t1",
    captureConsole: () => [{ type: "log", text: "hi" }],
    captureNetwork: () => [],
    closeAll: vi.fn(async () => {}),
  };
}

import { BrowsyPlugin } from "../src/plugin.js";
import { navigate as mockNavigate, evaluate as mockEvaluate } from "../src/core/connection.js";

async function loadTools() {
  const input: any = {
    $: (() => {}) as any,
    client: { app: { log: async () => {} } },
  };
  const result = await BrowsyPlugin(input, { installSkill: false } as any);
  return result.tool as Record<string, any>;
}

describe("OpenCode plugin (mocked @opencode-ai/plugin)", () => {
  it("registers all 8 browsy tools", async () => {
    const tools = await loadTools();
    const names = Object.keys(tools).sort();
    expect(names).toEqual([
      "browsy_console",
      "browsy_evaluate",
      "browsy_list_tabs",
      "browsy_navigate",
      "browsy_network_log",
      "browsy_recall",
      "browsy_screenshot",
      "browsy_wait",
    ]);
  });

  it("keeps browsy_navigate semantics: 'Navigated to <url>'", async () => {
    const tools = await loadTools();
    const out = await tools.browsy_navigate.execute(
      { url: "https://example.com", browserUrl: "ws://localhost:9222", targetId: "t1" },
      {} as any,
    );
    expect(out).toBe("Navigated to https://example.com");
    expect(mockNavigate).toHaveBeenCalledWith("ws://localhost:9222", "https://example.com", "t1");
  });

  it("keeps browsy_evaluate semantics: JSON.stringify(result, null, 2)", async () => {
    const tools = await loadTools();
    const out = await tools.browsy_evaluate.execute(
      { expression: "document.title", browserUrl: "ws://localhost:9222" },
      {} as any,
    );
    expect(out).toBe(JSON.stringify({ result: { value: "Example" } }, null, 2));
    expect(mockEvaluate).toHaveBeenCalled();
  });

  it("keeps browsy_recall semantics when memorius is unavailable", async () => {
    const tools = await loadTools();
    const out = await tools.browsy_recall.execute({ query: "save button" }, {} as any);
    expect(out).toBe("memorius is unavailable — no prior learnings recalled.");
  });
});
