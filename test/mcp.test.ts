// In-process MCP smoke test: a real MCP Client talks to the real browsy
// server over an in-memory transport pair. The CDP layer is mocked so no
// Chrome is needed. Verifies: (1) the client sees all 9 browsy tools via
// tools/list, and (2) tools/call returns structured text for a couple of
// the tools.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBrowsyServer } from "../src/mcp.js";
import { ensureCapturesDir, writeScreenshot, mayAutosave } from "../src/core/capture.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Clear mock call counts between tests so permission-gating assertions are
// not polluted by earlier tests.
beforeEach(() => {
  vi.clearAllMocks();
});

// Mock the whole CDP transport so no real WebSocket / HTTP is needed.
vi.mock("../src/core/connection.js", () => ({
  CDPConnection: class {
    connect = vi.fn(async () => {});
    send = vi.fn(async () => ({}));
    on = vi.fn();
    close = vi.fn(async () => {});
    isConnected = () => true;
    getTargetId = () => "mock-tab";
  },
  createConnection: vi.fn(async () => ({
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Page.navigate") return { frameId: "f", loaderId: "l" };
      if (method === "Runtime.evaluate") return { result: { value: "ok" } };
      if (method === "DOM.resolveNode") {
        if (params?.selector === "iframe#widget") return { object: { objectId: "frame-node-1" } };
        return { object: {} };
      }
      if (method === "DOM.getFrameOwner") return { backendNodeId: 1 };
      if (method === "Page.getFrameTree") {
        return {
          frameTree: {
            frame: { frameId: "root", url: "https://example.com" },
            childFrames: [{ frame: { frameId: "frame-1", parentFrameId: "root", url: "https://iframe.example.com", backendNodeId: 1 }, childFrames: [] }],
          },
        };
      }
      if (method === "Page.setFocusedFrame") return {};
      return {};
    }),
    on: vi.fn(),
    close: vi.fn(async () => {}),
    isConnected: () => true,
    getTargetId: () => "mock-tab",
  })),
  discoverPageTarget: vi.fn(async () => "mock-tab"),
  resolveWsUrl: vi.fn((u: string) => u),
}));

vi.mock("../src/core/actions.js", async (importOriginal: any) => {
  const actual = await importOriginal();
  return {
    ...actual,
    navigatePage: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    screenshot: vi.fn(async () => "aW1n"),
    fullPageScreenshot: vi.fn(async () => "aW1uZw=="),
    listTabs: vi.fn(async () => [{ id: "t1", url: "https://example.com", title: "Example", type: "page" }]),
    setFileInput: vi.fn(async () => {}),
    getPerformanceMetrics: vi.fn(async () => ({
      FirstContentfulPaint: 1200,
      LargestContentfulPaint: 2400,
    })),
  };
});

vi.mock("../src/core/capture.js", () => ({
  ensureCapturesDir: vi.fn(() => "/tmp/browsy-mcp-test/dev-notes/browsy-captures"),
  captureFileName: vi.fn(() => "browsy-capture-20240101-000000-000.png"),
  writeScreenshot: vi.fn(() => "/tmp/browsy-mcp-test/dev-notes/browsy-captures/browsy-capture-20240101-000000-000.png"),
  mayAutosave: vi.fn(() => false),
  tryAutoSave: vi.fn(() => ({ savedTo: "/tmp/browsy-mcp-test/dev-notes/browsy-captures/browsy-capture-20240101-000000-000.png" })),
}));

vi.mock("../src/core/diagnostics.js", () => ({
  preflight: vi.fn(async () => ({ ok: true, issues: [], reachable: true, pageTargets: 1 })),
}));

vi.mock("../src/memorius.js", async (importOriginal: any) => {
  const actual = await importOriginal();
  // A shell whose template-tag call returns a quiet/text chain with canned
  // recall output. Good enough for the browsy_recall tool path.
  const fakeShell = (..._exprs: unknown[]): any =>
    Promise.resolve({ quiet: () => ({ text: async () => "1. .save worked (score: 0.9)" }) });
  return {
    ...actual,
    getMemoriusShell: vi.fn(() => fakeShell),
  };
});

const EXPECTED_TOOLS = [
  "browsy_navigate",
  "browsy_new_tab",
  "browsy_list_tabs",
  "browsy_screenshot",
  "browsy_evaluate",
  "browsy_wait",
  "browsy_wait_idle",
  "browsy_a11y",
  "browsy_visual_baseline",
  "browsy_visual_compare",
  "browsy_intercept",
  "browsy_stealth",
  "browsy_record",
  "browsy_replay",
  "browsy_track_tabs",
  "browsy_switch_tab",
  "browsy_retry",
  "browsy_enter_frame",
  "browsy_exit_frame",
  "browsy_performance",
  "browsy_dialog",
  "browsy_upload",
  "browsy_download",
  "browsy_console",
  "browsy_network_log",
  "browsy_recall",
];

describe("browsy MCP server (in-process)", () => {
  it("lists all 9 browsy tools to an MCP client", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    for (const tool of EXPECTED_TOOLS) {
      expect(names).toContain(tool);
    }
    expect(names).toHaveLength(EXPECTED_TOOLS.length);

    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_evaluate returns the page result as JSON text", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_evaluate",
      arguments: { expression: "document.title" },
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    // The tool returns the evaluated value; it must not be an error.
    expect(res.isError).toBeFalsy();
    expect(text).toMatch(/ok/);

    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_list_tabs returns the tab list as JSON text", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({ name: "browsy_list_tabs", arguments: {} });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("t1");

    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_dialog accept returns accepted result", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_dialog",
      arguments: { action: "accept" },
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeTruthy(); // no dialog opened yet -> error
    expect(text).toMatch(/no JavaScript dialog/);

    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_screenshot auto-saves to the captures dir only with permission", async () => {
    // Grant permission via env var + mock the gate to true.
    process.env.BROWSY_AUTOSAVE_CAPTURES = "1";
    vi.mocked(mayAutosave).mockReturnValue(true);
    try {
      const server = createBrowsyServer();
      const client = new Client({ name: "test-client", version: "0.0.0" });
      const [serverTransport, clientTransport] =
        InMemoryTransport.createLinkedPair();
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      const res = await client.callTool({
        name: "browsy_screenshot",
        arguments: { fullPage: true },
      });
      const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
      expect(res.isError).toBeFalsy();
      expect(text).toContain("browsy-captures");
      expect(text).toContain("aW1uZw=="); // base64 still returned

      await client.close();
      await serverTransport.close();
    } finally {
      delete process.env.BROWSY_AUTOSAVE_CAPTURES;
    }
  });

  it("browsy_screenshot does not auto-save without permission", async () => {
    // Deny permission explicitly (defend against mock state leaking between tests).
    delete process.env.BROWSY_AUTOSAVE_CAPTURES;
    vi.mocked(mayAutosave).mockReturnValue(false);
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_screenshot",
      arguments: { fullPage: true },
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("aW1uZw=="); // base64 still returned
    expect(text).not.toContain("browsy-captures"); // nothing written to disk
    expect(vi.mocked(ensureCapturesDir)).not.toHaveBeenCalled();
    expect(vi.mocked(writeScreenshot)).not.toHaveBeenCalled();

    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_upload sets files on the matching input", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_upload",
      arguments: { selector: 'input[type="file"]', files: ["document.pdf", "image.png"] },
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("document.pdf");
    expect(text).toContain("image.png");

    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_a11y returns the accessibility tree", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_a11y",
      arguments: {},
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("[]");

    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_intercept configures block + mock rules", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_intercept",
      arguments: {
        rules: [
          { urlPattern: "*://*.tracker.com/*", action: "block" },
          { urlPattern: "*://api.example.com/*", action: "mock", response: { status: 200, body: "{}" } },
        ],
      },
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("blocked");
    expect(text).toContain("mocked");

    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_stealth enables anti-detection mode", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_stealth",
      arguments: {},
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("stealth");
    expect(text).toContain("true");

    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_record starts recording to a file", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const filePath = path.join(os.tmpdir(), "browsy-mcp-record.ndjson");
    const res = await client.callTool({
      name: "browsy_record",
      arguments: { filePath },
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain(filePath);

    await client.close();
    await serverTransport.close();
    fs.rmSync(filePath, { force: true });
  }, 15000);

  it("browsy_replay reads a recorded file", async () => {
    const filePath = path.join(os.tmpdir(), "browsy-mcp-replay.ndjson");
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        type: "message",
        method: "Page.navigate",
        params: { url: "https://example.com" },
        result: { frameId: "f1" },
        timestamp: 1,
      }) + "\n"
    );

    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_replay",
      arguments: { filePath },
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain(filePath);
    expect(text).toContain("replayed");

    await client.close();
    await serverTransport.close();
    fs.rmSync(filePath, { force: true });
  }, 15000);

  it("browsy_track_tabs lists page tabs", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_track_tabs",
      arguments: {},
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("tabs");    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_switch_tab activates a tab", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_switch_tab",
      arguments: { targetId: "tab-42" },
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("tab-42");

    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_retry returns retry configuration", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_retry",
      arguments: { maxAttempts: 5, baseDelayMs: 100, captureOnRetry: true },
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("5");
    expect(text).toContain("100");
    expect(text).toContain("true");

    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_enter_frame enters an iframe context", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_enter_frame",
      arguments: { selector: "iframe#widget" },
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("frame-1");

    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_exit_frame exits to root frame", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_exit_frame",
      arguments: {},
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("true");

    await client.close();
    await serverTransport.close();
  }, 15000);

  it("browsy_performance returns metrics", async () => {
    const server = createBrowsyServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: "browsy_performance",
      arguments: {},
    });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("FirstContentfulPaint");

    await client.close();
    await serverTransport.close();
  }, 15000);
});
