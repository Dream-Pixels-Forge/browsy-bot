---
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
  `browsy_navigate`, `browsy_new_tab`, `browsy_list_tabs`,
  `browsy_screenshot`, `browsy_evaluate`, `browsy_wait`,
  `browsy_console`, `browsy_network_log`, and `browsy_recall` directly.
- **CLI** — when a terminal is available, use the `browsy` binary:
  `browsy navigate <url>`, `browsy screenshot`, `browsy eval <js>`,
  `browsy wait <selector>`, `browsy click <selector>`,
  `browsy fill <selector> <value>`, `browsy page-text`,
  `browsy console`, `browsy network`, `browsy tabs`,
  `browsy new-tab [url]`, `browsy close-tab <id>`.
  Pass `--json` for machine-readable output.
- **Standalone library** — `import { createBrowsy } from "browsy-bot"`.

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

```bash
chromium --remote-debugging-port=9222 --headless --no-sandbox
```

The default endpoint is `ws://localhost:9222`. Override it with the
`browserUrl` argument (MCP), the `BROWSY_URL` env var, or `--url` (CLI).

## Using the tools

A typical validation flow:

```
1. browsy_navigate   url=<page>
2. browsy_wait       selector=".loaded"   (skip on static pages)
3. browsy_screenshot  fullPage=true        (or just the viewport)
4. browsy_console    (dump any JS errors)
5. browsy_network_log (dump any failing XHRs)
```

Notes:

- **Target a specific tab** with the `targetId` argument. Without it,
  the plugin auto-discovers the first page target via the HTTP
  `/json/list` endpoint — convenient, but you may not control which
  tab you're operating on. For deterministic behavior, list tabs
  first (`browsy_list_tabs` / `browsy tabs`) and pass the id.
- **Screenshots return base64 PNG.** Pass `outputPath` to write to a
  file instead.
- **`browsy_evaluate`** returns the evaluated value as JSON. For a
  promise, set `awaitPromise: true`.
- **Console / network capture** is session-scoped. It only shows
  events after the session opened a connection — run `browsy_navigate`
  (or any session-creating call) before `browsy_console` if you need
  early events.

## Learning with memorius

When memorius is installed, `browsy_recall` surfaces past learnings
before a browser task. Use it when you're about to repeat a known
flow. Store learnings yourself with the memorius CLI or tools if they
are available.

## Tips

- `--json` on the CLI gives stable, machine-readable output for
  downstream agents.
- `browsy tabs` lists the CDP targets; `browsy new-tab [url]` opens
  one; `browsy close-tab <id>` closes it.
- For `Page.getLayoutMetrics`-driven full-page screenshots, the page
  must be fully loaded (call `browsy_wait` first if the layout is not
  settled).
