// Browsy OpenCode plugin — registers CDP browser-automation tools with
// memorius-powered learning and an installable agent skill.
//
// See https://opencode.ai/docs/plugins/ for the plugin contract.
// See https://opencode.ai/docs/skills/ for the skill discovery contract.

import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { navigate, captureScreenshot, evaluate } from "./core/connection.js";
import { getSession, closeAllSessions } from "./core/session.js";
import {
  waitForSelector,
  navigatePage,
  listTabs as sessionListTabs,
} from "./core/actions.js";
import { remember, recall } from "./memorius.js";

export type BrowsyPluginOptions = {
  /** Chrome DevTools endpoint. Defaults to $BROWSY_URL or ws://localhost:9222. */
  url?: string;
  /** Optional default target ID (tab) to operate on. */
  targetId?: string;
  /**
   * When true, browsy tools store a learning to memorius after each successful
   * call. Defaults to $BROWSY_REMEMBER or false.
   */
  remember?: boolean;
  /** Memorius vault name. Defaults to "main". */
  memoriusVault?: string;
  /** Memorius shelf for browsy learnings. Defaults to "browsy". */
  memoriusShelf?: string;
  /**
   * When true, the plugin installs the bundled browsy skill into
   * ~/.config/opencode/skills/browsy/ on init. Defaults to true.
   */
  installSkill?: boolean;
};

function resolveUrl(options?: BrowsyPluginOptions): string {
  return options?.url ?? process.env.BROWSY_URL ?? "ws://localhost:9222";
}

const SKILL_NAME = "browsy";
const SKILL_CONTENT = `---
name: browsy
description: Drive Chrome/Chromium via the Chrome DevTools Protocol (CDP) for live UI validation, screenshots, page evaluation, and browser-automation learning. Works through the browsy MCP server, the browsy CLI, or any CDP adapter. Pairs with memorius to learn selectors and workflows across sessions.
license: MIT
metadata:
  audience: agents
  workflow: browser-automation
---

## What I do

Browsy gives you direct, zero-middleware control of a Chrome/Chromium
instance through the Chrome DevTools Protocol (CDP). No Puppeteer, no
Playwright, no ChromeDriver — you talk to Chrome's debugging interface
directly.

The same toolset is available in three interchangeable shapes. Pick
whichever your host agent already exposes:

- **MCP tools** — when the browsy MCP server is registered, use
  \`browsy_navigate\`, \`browsy_new_tab\`, \`browsy_list_tabs\`,
  \`browsy_screenshot\`, \`browsy_evaluate\`, \`browsy_wait\`,
  \`browsy_console\`, \`browsy_network_log\`, and \`browsy_recall\`
  directly.
- **CLI** — when a terminal is available, use the \`browsy\` binary:
  \`browsy navigate <url>\`, \`browsy screenshot\`, \`browsy eval <js>\`,
  \`browsy wait <selector>\`, \`browsy click <selector>\`,
  \`browsy fill <selector> <value>\`, \`browsy page-text\`,
  \`browsy console\`, \`browsy network\`, \`browsy tabs\`,
  \`browsy new-tab [url]\`, \`browsy close-tab <id>\`.
  Pass \`--json\` for machine-readable output.
- **Standalone library** — \`import { createBrowsy } from "browsy-bot"\`.

Prefer MCP when it's registered; it is the least-friction path. Fall
back to the CLI when no MCP server is available.

## When to use me

- Validate UI changes or visual regressions against a live page.
- Reproduce a bug from a URL: open the page, run JS, capture console +
  network state.
- Extract structured data from a rendered page without fragile selectors.
- Capture a screenshot for documentation or an issue report.
- Audit accessibility via the full AX tree.

## Prerequisites

Launch Chrome/Chromium with remote debugging before calling browsy:

\`\`\`bash
chromium --remote-debugging-port=9222 --headless --no-sandbox
\`\`\`

The default endpoint is \`ws://localhost:9222\`. Override it with the
\`browserUrl\` argument (MCP), the \`BROWSY_URL\` env var, or \`--url\` (CLI).

## Using the tools

A typical validation flow:

1. \`browsy_navigate\` url=<page>
2. \`browsy_wait\` selector=".loaded" (skip on static pages)
3. \`browsy_screenshot\` fullPage=true (or just the viewport)
4. \`browsy_console\` (dump any JS errors)
5. \`browsy_network_log\` (dump any failing XHRs)

Notes:

- Target a specific tab with the \`targetId\` argument. Without it, the
  plugin auto-discovers the first page target via the HTTP \`/json/list\`
  endpoint. For deterministic behavior, list tabs first and pass the id.
- Screenshots return base64 PNG. Pass \`outputPath\` to write to a file.
- \`browsy_evaluate\` returns the value as JSON; set \`awaitPromise: true\`
  for promises.
- Console / network capture is session-scoped: run a session-creating call
  (e.g. \`browsy_navigate\`) before \`browsy_console\` if you need early events.

## Learning with memorius

When memorius is installed, \`browsy_recall\` surfaces past learnings
before a browser task. Store learnings yourself with the memorius CLI or
tools if they are available.
`

function installSkill(options?: BrowsyPluginOptions): void {
  if (options?.installSkill === false) return;

  const skillsDir = path.join(
    os.homedir(),
    ".config",
    "opencode",
    "skills",
    SKILL_NAME,
  );

  try {
    fs.mkdirSync(skillsDir, { recursive: true });
    const target = path.join(skillsDir, "SKILL.md");
    // Idempotent: only write if missing or content differs.
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== SKILL_CONTENT) {
      fs.writeFileSync(target, SKILL_CONTENT, "utf8");
    }
  } catch {
    // Skill install is best-effort; never fail plugin load over it.
  }
}

export const BrowsyPlugin: Plugin = async (input, options) => {
  const opts = (options ?? {}) as BrowsyPluginOptions;
  const defaultUrl = resolveUrl(opts);
  const defaultTargetId = opts.targetId ?? process.env.BROWSY_TARGET_ID;
  const shouldRemember =
    opts.remember ?? (process.env.BROWSY_REMEMBER === "1");
  const vault = opts.memoriusVault ?? "main";
  const shelf = opts.memoriusShelf ?? "browsy";

  // Install the bundled skill so opencode's `skill` tool can discover it.
  installSkill(opts);

  // Log initialization through the structured logger.
  try {
    await input.client.app.log({
      body: {
        service: "browsy-bot",
        level: "info",
        message: "Browsy plugin initialized",
        extra: { url: defaultUrl, remember: shouldRemember, vault, shelf },
      },
    });
  } catch {
    // Logging is best-effort.
  }

  return {
    // After any browsy_* tool runs, best-effort store a learning to memorius.
    "tool.execute.after": async (toolInput, output) => {
      if (!shouldRemember) return;
      if (!toolInput.tool.startsWith("browsy_")) return;

      const summary = `${toolInput.tool} on session ${toolInput.sessionID}: ok`;
      void remember(
        input.$,
        {
          content: summary,
          shelf,
          folder: toolInput.sessionID,
        },
        { vault, shelf },
      );
    },

    tool: {
      browsy_navigate: tool({
        description:
          "Navigate a Chrome/Chromium tab connected via the Chrome DevTools " +
          "Protocol to the given URL. Requires Chrome launched with " +
          "--remote-debugging-port=9222.",
        args: {
          url: tool.schema.string().describe("The URL to navigate to."),
          browserUrl: tool.schema
            .string()
            .optional()
            .describe("CDP endpoint. Defaults to the plugin's configured url."),
          targetId: tool.schema
            .string()
            .optional()
            .describe("Target tab id to operate on. Optional."),
        },
        async execute(args) {
          const url = args.browserUrl ?? defaultUrl;
          const targetId = args.targetId ?? defaultTargetId;
          await navigate(url, args.url, targetId);
          return `Navigated to ${args.url}`;
        },
      }),

      browsy_screenshot: tool({
        description:
          "Capture a screenshot from a CDP-connected browser tab and return " +
          "it as a base64 PNG, or write it to a file when outputPath is given.",
        args: {
          outputPath: tool.schema
            .string()
            .optional()
            .describe(
              "Optional file path to save the PNG. Relative to the project " +
                "directory. If omitted, returns base64.",
            ),
          browserUrl: tool.schema.string().optional(),
          targetId: tool.schema.string().optional(),
        },
        async execute(args, ctx) {
          const url = args.browserUrl ?? defaultUrl;
          const targetId = args.targetId ?? defaultTargetId;
          const data = await captureScreenshot(
            url,
            { format: "png" },
            targetId,
          );

          if (args.outputPath) {
            const out = path.isAbsolute(args.outputPath)
              ? args.outputPath
              : path.join(ctx.directory, args.outputPath);
            fs.writeFileSync(out, Buffer.from(data, "base64"));
            return {
              title: "Screenshot saved",
              output: out,
              attachments: [
                {
                  type: "file",
                  mime: "image/png",
                  url: out,
                  filename: path.basename(out),
                },
              ],
            };
          }
          return {
            title: "Screenshot captured",
            output: data,
            metadata: { format: "png", base64: true },
          };
        },
      }),

      browsy_evaluate: tool({
        description:
          "Evaluate a JavaScript expression in the page context of a " +
          "CDP-connected browser tab and return the result as JSON.",
        args: {
          expression: tool.schema
            .string()
            .describe("JavaScript expression to evaluate in the page."),
          browserUrl: tool.schema.string().optional(),
          targetId: tool.schema.string().optional(),
        },
        async execute(args) {
          const url = args.browserUrl ?? defaultUrl;
          const targetId = args.targetId ?? defaultTargetId;
          const result = await evaluate(url, args.expression, targetId);
          return JSON.stringify(result, null, 2);
        },
      }),

      browsy_recall: tool({
        description:
          "Search past browsy browser-automation learnings stored in the " +
          "memorius vault. Use before a browser task to surface relevant " +
          "selectors, page quirks, and navigation flows from prior sessions. " +
          "Returns a formatted list of matching memories; empty if memorius " +
          "is unavailable.",
        args: {
          query: tool.schema
            .string()
            .describe("Natural-language description of what to recall."),
          n: tool.schema
            .number()
            .optional()
            .describe("Max results. Defaults to 5."),
        },
        async execute(args) {
          const n = args.n ?? 5;
          const result = await recall(input.$, args.query, {
            vault,
            shelf,
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
        },
      }),

      // ---- additive tools over the core (MCP/CLI parity) ----------------

      browsy_wait: tool({
        description:
          "Poll the DOM until an element matching `selector` exists. " +
          "Returns when found; throws on timeout.",
        args: {
          selector: tool.schema.string().describe("CSS selector to wait for."),
          timeoutMs: tool.schema.number().optional().describe("Max wait ms (default 10000)."),
          intervalMs: tool.schema.number().optional().describe("Poll interval ms (default 100)."),
          browserUrl: tool.schema.string().optional(),
          targetId: tool.schema.string().optional(),
        },
        async execute(args) {
          const url = args.browserUrl ?? defaultUrl;
          const targetId = args.targetId ?? defaultTargetId;
          const session = await getSession(url, { targetId });
          await waitForSelector(session, args.selector, {
            timeoutMs: args.timeoutMs,
            intervalMs: args.intervalMs,
          });
          return `Found ${args.selector}`;
        },
      }),

      browsy_console: tool({
        description:
          "Return console.log/info/warn/error/exception entries captured " +
          "from the page since this OpenCode process started.",
        args: {
          browserUrl: tool.schema.string().optional(),
          targetId: tool.schema.string().optional(),
        },
        async execute(args) {
          const url = args.browserUrl ?? defaultUrl;
          const targetId = args.targetId ?? defaultTargetId;
          const session = await getSession(url, { targetId });
          return JSON.stringify(session.captureConsole(), null, 2);
        },
      }),

      browsy_network_log: tool({
        description:
          "Return network requests captured from the page since this " +
          "OpenCode process started (method, url, status).",
        args: {
          browserUrl: tool.schema.string().optional(),
          targetId: tool.schema.string().optional(),
        },
        async execute(args) {
          const url = args.browserUrl ?? defaultUrl;
          const targetId = args.targetId ?? defaultTargetId;
          const session = await getSession(url, { targetId });
          return JSON.stringify(session.captureNetwork(), null, 2);
        },
      }),

      browsy_list_tabs: tool({
        description: "List all open browser tabs (id, url, title, type).",
        args: {
          browserUrl: tool.schema.string().optional(),
          targetId: tool.schema.string().optional(),
        },
        async execute(args) {
          const url = args.browserUrl ?? defaultUrl;
          const targetId = args.targetId ?? defaultTargetId;
          const session = await getSession(url, { targetId });
          return JSON.stringify(await sessionListTabs(session), null, 2);
        },
      }),
    },
  };
};

export default BrowsyPlugin;