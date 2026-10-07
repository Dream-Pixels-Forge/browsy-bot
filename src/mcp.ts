// Browsy MCP server — universal access path for any MCP client
// (Claude Code, Cursor, Gemini CLI, Cline, Continue, Zed, Hermes, ...).
//
// One stdio server exposes the full browsy toolset. No OpenCode, no Bun:
// it runs under Node, uses the tool-agnostic core, and reaches memorius
// through the Node shell (child_process) when no Bun shell is present.
//
//   node dist/mcp.js            # after build
//   npx tsx src/mcp.ts          # dev
//   browsy mcp                  # via the CLI subcommand

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getSession, closeAllSessions } from "./core/session.js";
import {
  waitForSelector,
  screenshot as sessionScreenshot,
  fullPageScreenshot,
  navigatePage,
  listTabs as sessionListTabs,
} from "./core/actions.js";
import { recall, getMemoriusShell } from "./memorius.js";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_BROWSER_URL =
  process.env.BROWSY_URL ?? "ws://localhost:9222";
const MEMORIUS_VAULT = process.env.BROWSY_MEMORIUS_VAULT ?? "main";
const MEMORIUS_SHELF = process.env.BROWSY_MEMORIUS_SHELF ?? "browsy";

// --- result helpers ---------------------------------------------------------

function ok(value: unknown, note?: string): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
  const payload = note ? `${text}\n\n${note}` : text;
  return { content: [{ type: "text", text: payload }] };
}

function fail(e: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const message = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: `browsy error: ${message}` }], isError: true };
}

// Wrap an async tool body: catch -> isError result. Keep the shape stable so
// MCP clients can always JSON-parse the text on success.
async function run<T>(fn: () => Promise<T>): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (e) {
    return fail(e);
  }
}

// Common optional addressing args shared by most tools.
const addressSchema = {
  browserUrl: z
    .string()
    .optional()
    .describe("CDP endpoint. Defaults to $BROWSY_URL or ws://localhost:9222."),
  targetId: z
    .string()
    .optional()
    .describe("Specific tab target to operate on. Optional; auto-discovers when omitted."),
};

// --- server factory (in-process; also used by the test harness) -------------

export interface BrowsyMcpOptions {
  /** Instructs the server to skip wiring the stdio transport. For tests. */
  dryRun?: boolean;
}

export function createBrowsyServer(): McpServer {
  const server = new McpServer({
    name: "browsy",
    version: "0.1.0",
  });

  server.registerTool(
    "browsy_navigate",
    {
      description:
        "Navigate a CDP-connected browser tab to a URL.",
      inputSchema: {
        url: z.string().describe("The URL to navigate to."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const targetId = args.targetId;
        // Use a session so subsequent console/network captures keep state.
        const session = await getSession(url, { targetId });
        await navigatePage(session, args.url);
        return `Navigated to ${args.url}`;
      }),
  );

  server.registerTool(
    "browsy_new_tab",
    {
      description:
        "Open a new browser tab. Optionally navigate it to a URL. Returns the new tab's target id.",
      inputSchema: {
        url: z
          .string()
          .optional()
          .describe("URL to open in the new tab. Defaults to about:blank."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url);
        const targetId = await session.newTab(args.url);
        return { opened: targetId, url: args.url ?? "about:blank" };
      }),
  );

  server.registerTool(
    "browsy_list_tabs",
    {
      description: "List all open browser tabs (target id, url, title, type).",
      inputSchema: { ...addressSchema },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const tabs = await sessionListTabs(session);
        return tabs;
      }),
  );

  server.registerTool(
    "browsy_screenshot",
    {
      description:
        "Capture a screenshot. fullPage=true captures the entire scrollable page; otherwise just the viewport. Returns base64 PNG; with outputPath, writes a file and returns the path.",
      inputSchema: {
        fullPage: z.boolean().optional().describe("Capture the full scrollable page, not just the viewport."),
        format: z.enum(["png", "jpeg"]).optional().describe("Image format. Defaults to png."),
        quality: z.number().int().min(0).max(100).optional().describe("JPEG quality 0-100 (ignored for png)."),
        outputPath: z
          .string()
          .optional()
          .describe("Write the image to this file (absolute, or relative to the server cwd)."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const options = {
          format: args.format ?? "png",
          quality: args.quality,
        };
        const data = args.fullPage
          ? await fullPageScreenshot(session, options)
          : await sessionScreenshot(session, options);
        if (args.outputPath) {
          const out = path.isAbsolute(args.outputPath)
            ? args.outputPath
            : path.join(process.cwd(), args.outputPath);
          fs.writeFileSync(out, Buffer.from(data, "base64"));
          return { savedTo: out, format: options.format, bytes: Math.round(data.length * 0.75) };
        }
        return { format: options.format, base64: data };
      }),
  );

  server.registerTool(
    "browsy_evaluate",
    {
      description:
        "Evaluate a JavaScript expression in the page context and return the JSON result.",
      inputSchema: {
        expression: z.string().describe("JavaScript expression to evaluate in the page."),
        awaitPromise: z
          .boolean()
          .optional()
          .describe("If the expression yields a promise, await it before returning."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const conn = await session.page();
        const result = await conn.send<{ result?: unknown; exceptionDetails?: unknown }>(
          "Runtime.evaluate",
          {
            expression: args.expression,
            returnByValue: true,
            awaitPromise: args.awaitPromise ?? false,
          },
        );
        if ((result as { exceptionDetails?: unknown }).exceptionDetails) {
          throw new Error("page JS threw; see exceptionDetails");
        }
        return (result as { result?: { value?: unknown } }).result?.value;
      }),
  );

  server.registerTool(
    "browsy_wait",
    {
      description:
        "Poll the DOM until an element matching `selector` exists, or fail on timeout.",
      inputSchema: {
        selector: z.string().describe("CSS selector to wait for."),
        timeoutMs: z.number().int().positive().optional().describe("Max total wait in ms. Defaults to 10000."),
        intervalMs: z.number().int().positive().optional().describe("Poll interval in ms. Defaults to 100."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        await waitForSelector(session, args.selector, {
          timeoutMs: args.timeoutMs,
          intervalMs: args.intervalMs,
        });
        return `Found ${args.selector}`;
      }),
  );

  server.registerTool(
    "browsy_console",
    {
      description:
        "Return console.log/info/warn/error/exception entries captured from the page since this browsy process started. Best when the session has been used for navigation / evaluate.",
      inputSchema: { ...addressSchema },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        return session.captureConsole();
      }),
  );

  server.registerTool(
    "browsy_network_log",
    {
      description:
        "Return network requests captured from the page since this browsy process started (method, url, status).",
      inputSchema: { ...addressSchema },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        return session.captureNetwork();
      }),
  );

  server.registerTool(
    "browsy_recall",
    {
      description:
        "Search past browsy browser-automation learnings in the memorius vault. Use before a browser task to surface selectors, page quirks, and flows. Empty if memorius is unavailable.",
      inputSchema: {
        query: z.string().describe("Natural-language description of what to recall."),
        n: z.number().int().positive().optional().describe("Max results. Defaults to 5."),
      },
    },
    async (args) =>
      run(async () => {
        const n = args.n ?? 5;
        const shell = getMemoriusShell();
        const result = await recall(shell, args.query, {
          vault: MEMORIUS_VAULT,
          shelf: MEMORIUS_SHELF,
          n,
        });
        if (!result.available) {
          return "memorius is unavailable — no prior learnings recalled.";
        }
        if (result.hits && result.hits.length > 0) {
          const lines = result.hits.map(
            (h, i) =>
              `  ${i + 1}. ${h.content}${h.score !== undefined ? ` (score: ${h.score})` : ""}`,
          );
          return `Recalled ${result.hits.length} memor${result.hits.length === 1 ? "y" : "ies"}:\n${lines.join("\n")}`;
        }
        return "No matching memories found.";
      }),
  );

  return server;
}

// --- stdio entrypoint --------------------------------------------------------

export async function startMcpServer(): Promise<void> {
  const server = createBrowsyServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("browsy MCP server running on stdio\n");
  // Clean up cached sessions when the process exits.
  process.on("SIGINT", async () => {
    await closeAllSessions();
    process.exit(0);
  });
}

// Allow `tsx src/mcp.ts` / `node dist/mcp.js` to run the server directly.
// Detect "is this the running entry module" via import.meta.url matching argv[1].
const isMainModule = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const here = import.meta.url;
    return entry.endsWith("mcp.ts") || entry.endsWith("mcp.js");
  } catch {
    return false;
  }
})();

if (isMainModule) {
  startMcpServer().catch((e) => {
    process.stderr.write(`browsy mcp failed to start: ${String(e)}\n`);
    process.exit(1);
  });
}
