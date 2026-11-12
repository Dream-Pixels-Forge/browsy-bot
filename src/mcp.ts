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
  acceptDialog,
  dismissDialog,
  dialogText,
  setFileInput,
  setDownloadBehavior,
  listDownloads,
  waitForNetworkIdle,
  getAccessibilityTree,
  captureBaseline,
  compareScreenshot,
  setRequestInterception,
  getPausedRequests,
  enableStealth,
  recordSession,
  replaySession,
  trackNewTabs,
  switchToTab,
  retryableAction,
  enterFrame,
  exitFrame,
  getPerformanceMetrics,
  checkPerformanceBudget,
  emulateDevice,
  setGeolocation,
  setDeviceOrientation,
  captureDomSnapshot,
  diffDomSnapshots,
  saveDomBaseline,
  compareDom,
  getCookies,
  setCookies,
  deleteCookies,
  getStorage,
} from "./core/actions.js";
import type { InterceptRule } from "./core/intercept.js";
import { preflight } from "./core/diagnostics.js";
import {
  ensureCapturesDir,
  captureFileName,
  writeScreenshot,
  tryAutoSave,
  mayAutosave,
} from "./core/capture.js";
import { recall, getMemoriusShell } from "./memorius.js";
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
    version: "0.2.0",
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
        // Fail fast with an actionable message when the browser isn't usable.
        const health = await preflight(url);
        if (!health.ok) throw new Error(health.issues.join(" "));
        const session = await getSession(url, { targetId: args.targetId });
        const options = {
          format: args.format ?? "png",
          quality: args.quality,
        };
        const data = args.fullPage
          ? await fullPageScreenshot(session, options)
          : await sessionScreenshot(session, options);
        let savedTo: string | undefined;
        let saveError: string | undefined;
        if (args.outputPath) {
          // Explicit output path: the user asked for a specific file, so a
          // write failure must surface.
          const out = path.isAbsolute(args.outputPath)
            ? args.outputPath
            : path.join(process.cwd(), args.outputPath);
          savedTo = writeScreenshot(data, out);
        } else if (mayAutosave()) {
          // Auto-save only with explicit user permission (env var). Never
          // crashes the call when the project dir isn't writable.
          const dir = ensureCapturesDir();
          if (dir) {
            const result = tryAutoSave(data, dir, options.format);
            savedTo = result.savedTo;
            saveError = result.error;
          }
        }
        return {
          format: options.format,
          base64: data,
          savedTo,
          saveError,
          bytes: Math.round(data.length * 0.75),
        };
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
    "browsy_wait_idle",
    {
      description:
        "Wait until the network is idle (no in-flight requests for idleMs), useful after SPA navigations.",
      inputSchema: {
        idleMs: z
          .number()
          .int()
          .positive()
          .optional()
          .default(500)
          .describe("ms of inactivity before resolving. Defaults to 500."),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .default(10000)
          .describe("Max ms to wait before throwing. Defaults to 10000."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        await waitForNetworkIdle(session, {
          idleMs: args.idleMs,
          timeoutMs: args.timeoutMs,
        });
        return `Network idle after ${args.idleMs ?? 500}ms of inactivity`;
      }),
  );

  server.registerTool(
    "browsy_a11y",
    {
      description:
        "Return the live accessibility tree, simplified to role/name/value/state per node. Useful for a11y audits and deterministic UI assertions.",
      inputSchema: { ...addressSchema },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        return getAccessibilityTree(session);
      }),
  );

  server.registerTool(
    "browsy_visual_baseline",
    {
      description:
        "Capture a full-page screenshot and save it as a visual-regression baseline under dev-notes/browsy-captures/baselines/.",
      inputSchema: {
        name: z.string().describe("Baseline name (used as the file name)."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const path = await captureBaseline(session, args.name);
        return { ok: true, path, name: args.name };
      }),
  );

  server.registerTool(
    "browsy_visual_compare",
    {
      description:
        "Capture a full-page screenshot and pixel-compare it against a saved baseline. Returns pass/fail plus diff stats.",
      inputSchema: {
        name: z.string().describe("Baseline name to compare against."),
        threshold: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .default(0)
          .describe("Max fraction of differing pixels to still pass (0..1)."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const result = await compareScreenshot(session, args.name, {
          threshold: args.threshold,
        });
        return { ...result, name: args.name };
      }),
  );

  server.registerTool(
    "browsy_intercept",
    {
      description:
        "Block or mock network requests. Block rules use Network.setBlockedURLs; mock rules intercept Fetch.requestPaused and fulfill with a canned response.",
      inputSchema: {
        rules: z
          .array(
            z.object({
              urlPattern: z.string().describe("URL pattern (supports * wildcard)"),
              action: z.enum(["block", "mock"]),
              response: z
                .object({
                  status: z.number().optional(),
                  body: z.string().optional(),
                  headers: z
                    .record(z.string(), z.string())
                    .optional(),
                })
                .optional(),
            })
          )
          .describe("Interception rules"),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        await setRequestInterception(session, args.rules as InterceptRule[]);
        const blocked = args.rules.filter((r) => r.action === "block").length;
        const mocked = args.rules.filter((r) => r.action === "mock").length;
        return { ok: true, rules: args.rules.length, blocked, mocked };
      }),
  );

  server.registerTool(
    "browsy_stealth",
    {
      description:
        "Enable stealth mode: inject an anti-detection script on every new document that neutralizes navigator.webdriver, spoofs plugins/languages/WebGL, and adds a chrome object.",
      inputSchema: { ...addressSchema },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        await enableStealth(session);
        return { ok: true, stealth: true };
      }),
  );

  server.registerTool(
    "browsy_record",
    {
      description:
        "Record all CDP messages and events from a session to an NDJSON file for offline replay.",
      inputSchema: {
        filePath: z.string().describe("Path to write the NDJSON recording."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const { stopRecording } = await recordSession(session, args.filePath);
        return { ok: true, filePath: args.filePath, stopRecording: "call browsy_stop_recording" };
      }),
  );

  server.registerTool(
    "browsy_replay",
    {
      description:
        "Replay a recorded NDJSON session into a mock connection. Returns the replayed connection handle.",
      inputSchema: {
        filePath: z.string().describe("Path to the NDJSON recording to replay."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const conn = await replaySession(args.filePath);
        return { ok: true, filePath: args.filePath, targetId: conn.getTargetId() };
      }),
  );

  server.registerTool(
    "browsy_track_tabs",
    {
      description:
        "List all open page tabs and register a handler for new tabs (popups, target=_blank links). Returns target id, url, and title.",
      inputSchema: { ...addressSchema },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const tabs = await trackNewTabs(session);
        return { tabs, count: tabs.length };
      }),
  );

  server.registerTool(
    "browsy_switch_tab",
    {
      description:
        "Activate a tab by target ID and set up auto-attach for subsequent page-domain commands.",
      inputSchema: {
        targetId: z.string().describe("The target id of the tab to switch to."),
        browserUrl: z
          .string()
          .optional()
          .describe("CDP endpoint. Defaults to $BROWSY_URL or ws://localhost:9222."),
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        await switchToTab(session, args.targetId);
        return { ok: true, targetId: args.targetId };
      }),
  );

  server.registerTool(
    "browsy_retry",
    {
      description:
        "Retry a flaky action with exponential backoff. Captures optional screenshots to dev-notes/browsy-captures/retries/ between attempts.",
      inputSchema: {
        maxAttempts: z
          .number()
          .int()
          .positive()
          .optional()
          .default(3)
          .describe("Max number of attempts. Defaults to 3."),
        baseDelayMs: z
          .number()
          .int()
          .positive()
          .optional()
          .default(500)
          .describe("Base delay in ms. Defaults to 500."),
        captureOnRetry: z
          .boolean()
          .optional()
          .default(false)
          .describe("Capture a screenshot between attempts. Defaults to false."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        // browsy_retry is a building block: it takes no inline action, so
        // it returns its configuration for the caller to apply in a script.
        return {
          ok: true,
          maxAttempts: args.maxAttempts,
          baseDelayMs: args.baseDelayMs,
          captureOnRetry: args.captureOnRetry,
          message:
            "retryableAction is a library primitive — use via the browsy JS API or script",
        };
      }),
  );

  server.registerTool(
    "browsy_enter_frame",
    {
      description:
        "Enter an iframe context by CSS selector. Subsequent page-domain commands target the iframe.",
      inputSchema: {
        selector: z.string().describe("CSS selector for the iframe element."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const frameId = await enterFrame(session, args.selector);
        return { ok: true, frameId, selector: args.selector };
      }),
  );

  server.registerTool(
    "browsy_exit_frame",
    {
      description:
        "Exit the current iframe context, returning to the root (top-level) frame.",
      inputSchema: { ...addressSchema },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        await exitFrame(session);
        return { ok: true };
      }),
  );

  server.registerTool(
    "browsy_performance",
    {
      description:
        "Capture Core Web Vitals and navigation timing metrics from the page.",
      inputSchema: { ...addressSchema },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const metrics = await getPerformanceMetrics(session);
        return { ok: true, metrics };
      }),
  );

  server.registerTool(
    "browsy_capture_dom",
    {
      description:
        "Capture the current page DOM as a serializable snapshot and save it as a baseline under dev-notes/browsy-captures/dom-baselines/.",
      inputSchema: {
        name: z.string().describe("Baseline name (used as the file name)."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const filePath = await saveDomBaseline(session, args.name);
        return { ok: true, path: filePath, name: args.name };
      }),
  );

  server.registerTool(
    "browsy_diff_dom",
    {
      description:
        "Capture the current DOM and pixel-compare it against a saved DOM baseline. Returns pass/fail plus a diff report.",
      inputSchema: {
        name: z.string().describe("Baseline name to diff against."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const result = await compareDom(session, args.name);
        return {
          ok: result.pass,
          ...result,
          name: args.name,
          message: result.pass
            ? `DOM matches baseline ${args.name}`
            : `DOM differs from baseline ${args.name}: ${result.added.length + result.removed.length + result.changed.length} change`,
        };
      }),
  );

  server.registerTool(
    "browsy_get_cookies",
    {
      description:
        "Get all cookies visible to the page (HTTP-only cookies included via CDP).",
      inputSchema: { ...addressSchema },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const cookies = await getCookies(session);
        return {
          ok: true,
          cookies,
          count: cookies.length,
          message: `${cookies.length} cookie${cookies.length === 1 ? '' : 's'} found`,
        };
      }),
  );

  server.registerTool(
    "browsy_set_cookies",
    {
      description:
        "Set cookies on the page. Cookies are domain-scoped; pass matching domain/path.",
      inputSchema: {
        cookies: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              domain: z.string(),
              path: z.string().optional(),
              secure: z.boolean().optional(),
              httpOnly: z.boolean().optional(),
            }),
          )
          .describe("Cookies to set."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        await setCookies(session, args.cookies);
        return {
          ok: true,
          set: args.cookies.length,
          message: `Set ${args.cookies.length} cookie${args.cookies.length === 1 ? '' : 's'}`,
        };
      }),
  );

  server.registerTool(
    "browsy_delete_cookies",
    {
      description:
        "Delete cookies matching name + domain (+ optional path).",
      inputSchema: {
        name: z.string().describe("Cookie name."),
        domain: z.string().describe("Cookie domain."),
        path: z.string().optional().describe("Cookie path."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        await deleteCookies(session, {
          name: args.name,
          domain: args.domain,
          path: args.path,
        });
        return { ok: true, name: args.name, domain: args.domain };
      }),
  );

  server.registerTool(
    "browsy_get_storage",
    {
      description:
        "Read localStorage + sessionStorage for the page's current origin.",
      inputSchema: {
        origin: z
          .string()
          .optional()
          .describe("Origin (e.g. https://example.com). Defaults to page origin."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const storage = await getStorage(session, args.origin);
        return { ok: true, ...storage };
      }),
  );

  server.registerTool(
    "browsy_emulate_device",
    {
      description:
        "Emulate a mobile device: set device metrics (width/height/scale), user agent, and touch emulation.",
      inputSchema: {
        device: z
          .object({
            name: z.string().optional(),
            width: z.number().positive(),
            height: z.number().positive(),
            deviceScaleFactor: z.number().positive().optional(),
            mobile: z.boolean().optional(),
            userAgent: z.string().optional(),
          })
          .describe("Device profile or custom device metrics."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        await emulateDevice(session, args.device);
        return { ok: true, device: args.device };
      }),
  );

  server.registerTool(
    "browsy_set_geolocation",
    {
      description:
        "Override the geolocation reported to the page (latitude, longitude, accuracy in meters).",
      inputSchema: {
        latitude: z.number().describe("Latitude in degrees."),
        longitude: z.number().describe("Longitude in degrees."),
        accuracy: z.number().optional().default(10).describe("Accuracy in meters."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        await setGeolocation(session, args.latitude, args.longitude, args.accuracy);
        return { ok: true, latitude: args.latitude, longitude: args.longitude, accuracy: args.accuracy };
      }),
  );

  server.registerTool(
    "browsy_set_device_orientation",
    {
      description:
        "Override the device orientation reported to the page (alpha/beta/gamma in degrees).",
      inputSchema: {
        alpha: z.number().describe("Alpha rotation (degrees)."),
        beta: z.number().describe("Beta tilt (degrees)."),
        gamma: z.number().describe("Gamma tilt (degrees)."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        await setDeviceOrientation(session, args.alpha, args.beta, args.gamma);
        return { ok: true, alpha: args.alpha, beta: args.beta, gamma: args.gamma };
      }),
  );

  server.registerTool(
    "browsy_dialog",
    {
      description:
        "Accept, dismiss, or read the text of the most recent JavaScript dialog (alert / confirm / prompt) opened by the page.",
      inputSchema: {
        action: z
          .enum(["accept", "dismiss", "text"])
          .optional()
          .default("accept")
          .describe("What to do with the dialog: accept, dismiss, or return its text."),
        promptText: z
          .string()
          .optional()
          .describe("Text to enter if the dialog is a prompt."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        const action = args.action ?? "accept";
        if (action === "text") {
          return { text: await dialogText(session) };
        }
        if (action === "accept") {
          const result = await acceptDialog(session, args.promptText);
          return { accepted: true, result };
        }
        await dismissDialog(session);
        return { accepted: false };
      }),
  );

  server.registerTool(
    "browsy_upload",
    {
      description:
        "Set files on the first <input type='file'> matching `selector`. Returns ok when the files are set.",
      inputSchema: {
        selector: z.string().describe("CSS selector for the file input."),
        files: z
          .array(z.string())
          .describe("Absolute file paths to upload."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        await setFileInput(session, args.selector, args.files);
        return { ok: true, files: args.files, selector: args.selector };
      }),
  );

  server.registerTool(
    "browsy_download",
    {
      description:
        "Configure Chrome download behavior (allow/deny) and optional download path. Download events are captured on the page connection.",
      inputSchema: {
        behavior: z
          .enum(["allow", "deny"])
          .optional()
          .default("allow")
          .describe("Whether to allow or deny downloads."),
        downloadPath: z
          .string()
          .optional()
          .describe("Directory to save downloads to. Defaults to dev-notes/browsy-captures/downloads."),
        ...addressSchema,
      },
    },
    async (args) =>
      run(async () => {
        const url = args.browserUrl ?? DEFAULT_BROWSER_URL;
        const session = await getSession(url, { targetId: args.targetId });
        let downloadPath = args.downloadPath;
        if (!downloadPath) {
          const dir = ensureCapturesDir();
          downloadPath = dir ? path.join(dir, "downloads") : undefined;
        }
        await setDownloadBehavior(session, args.behavior ?? "allow", downloadPath);
        return { ok: true, behavior: args.behavior ?? "allow", downloadPath };
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
