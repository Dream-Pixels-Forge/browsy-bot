// In-process MCP smoke test: a real MCP Client talks to the real browsy
// server over an in-memory transport pair. The CDP layer is mocked so no
// Chrome is needed. Verifies: (1) the client sees all 9 browsy tools via
// tools/list, and (2) tools/call returns structured text for a couple of
// the tools.
import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBrowsyServer } from "../src/mcp.js";

// Mock the whole CDP transport so no real WebSocket / HTTP is needed.
vi.mock("../src/core/connection.js", () => ({
  createConnection: vi.fn(async () => ({
    send: vi.fn(async (method: string) => {
      if (method === "Page.navigate") return { frameId: "f", loaderId: "l" };
      if (method === "Runtime.evaluate") return { result: { value: "ok" } };
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
  };
});

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
});
