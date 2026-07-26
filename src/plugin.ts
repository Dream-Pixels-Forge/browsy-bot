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
import { navigate, captureScreenshot, evaluate } from "./connection.js";
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
description: Drive Chrome/Chromium via the Chrome DevTools Protocol for live UI validation, screenshots, page evaluation, performance and accessibility auditing. Pairs with memorius to learn selectors and workflows across sessions.
license: MIT
compatibility: opencode
metadata:
  audience: agents
  workflow: browser-automation
---

## What I do

Browsy gives you direct, zero-middleware control of a Chrome/Chromium instance
through the Chrome DevTools Protocol (CDP). The browsy plugin registers these
custom tools:

- **browsy_navigate** — navigate a connected tab to a URL.
- **browsy_screenshot** — capture a screenshot (base64 PNG or file).
- **browsy_evaluate** — run JavaScript in the page context.
- **browsy_recall** — search past browser-automation learnings from memorius.

## When to use me

Use browsy when you need to interact with a real running browser:

- Validate UI changes or visual regressions against a live page.
- Reproduce a bug from a URL: open the page, run JS, capture console state.
- Extract structured data from a rendered page without fragile selectors.
- Audit accessibility via the full AX tree.
- Capture a screenshot for documentation or an issue report.

## Prerequisites

Launch Chrome with remote debugging before calling browsy tools:

\`\`\`bash
chromium --remote-debugging-port=9222 --headless --no-sandbox
\`\`\`

The default endpoint is ws://localhost:9222. Override with the plugin's "url"
option or the BROWSY_URL environment variable.

## Learning with memorius

When the plugin is configured with "remember": true (or BROWSY_REMEMBER=1),
every successful browsy tool call stores a compact learning to memorius under
the "browsy" shelf — the URL, the operation, and the outcome. Use the
**browsy_recall** tool before a browser task to surface relevant past
learnings (selectors that worked, page-specific quirks, navigation flows).

You can also store and search learnings directly with the memorius tools if
they are available: \`memorius_search\`, \`memorius_store\`.

## Tips

- Target a specific tab with the "targetId" argument; without it the plugin
  talks to the browser-level endpoint (/devtools/browser), which does not
  support the Page domain. For navigate/screenshot, prefer providing a
  targetId or let the convenience helpers open /devtools/page/<id>.
- Screenshots return base64 PNG. Pass "outputPath" to write to a file
  relative to the project directory instead.
- For evaluate, returnByValue is enabled so the result comes back as JSON.
`;

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
        service: "browsy-plugin",
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
    },
  };
};

export default BrowsyPlugin;