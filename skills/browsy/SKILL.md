---
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

```bash
chromium --remote-debugging-port=9222 --headless --no-sandbox
```

The default endpoint is ws://localhost:9222. Override with the plugin's "url"
option or the BROWSY_URL environment variable.

## Learning with memorius

When the plugin is configured with "remember": true (or BROWSY_REMEMBER=1),
every successful browsy tool call stores a compact learning to memorius under
the "browsy" shelf — the URL, the operation, and the outcome. Use the
**browsy_recall** tool before a browser task to surface relevant past
learnings (selectors that worked, page-specific quirks, navigation flows).

You can also store and search learnings directly with the memorius tools if
they are available: `memorius_search`, `memorius_store`.

## Tips

- Target a specific tab with the "targetId" argument; without it the plugin
  talks to the browser-level endpoint (/devtools/browser), which does not
  support the Page domain. For navigate/screenshot, prefer providing a
  targetId or let the convenience helpers open /devtools/page/<id>.
- Screenshots return base64 PNG. Pass "outputPath" to write to a file
  relative to the project directory instead.
- For evaluate, returnByValue is enabled so the result comes back as JSON.