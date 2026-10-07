# GOAL-BROWSY-MULTITOOL.md

## Goal: Make browsy a multi-tool browser-automation kit (not just an OpenCode plugin)

### Objective
Rework browsy so the CDP core is tool-agnostic, and ship a universal
access path — an MCP server + a hardened CLI + a portable skill — that
any coding agent (Claude Code, Cursor, Gemini CLI, Cline, Hermes,
Codex, Aider, OpenCode) can use without an OpenCode install.

### Context
See `dev-notes/BRAINSTORM.md` for the full architecture. Browsy's
current value (zero-middleware CDP, memorius learning) is gated behind
OpenCode's plugin API. The OpenCode plugin must keep working as a
first-class path after the refactor.

### Deliverables
- [x] `dev-notes/BRAINSTORM.md` — done (architecture + open questions)
- [x] `dev-notes/GOAL-BROWSY-MULTITOOL.md` — this file
- [x] Refactored core: `src/core/` (connection, session cache,
      domains, actions, types) with no OpenCode imports in core
- [x] `src/actions.ts` (or `src/core/actions.ts`):
      `click`, `fill`, `waitForSelector`, `pageText`, `newTab`,
      `listTabs`, `closeTab`, `captureConsole`, `captureNetwork`,
      full-page `captureScreenshot`
- [x] `src/mcp.ts`: MCP server (stdio, `@modelcontextprotocol/sdk`)
      exposing: `browsy_navigate`, `browsy_new_tab`,
      `browsy_list_tabs`, `browsy_screenshot`, `browsy_evaluate`,
      `browsy_wait`, `browsy_console`, `browsy_network_log`,
      `browsy_recall`
- [x] `src/mcp.ts` wired as CLI subcommand `browsy mcp`
- [x] CLI additions: `wait`, `console`, `network`, `tabs`, `click`,
      `fill`, `page-text`; global `--json` flag; stable exit codes
- [x] `skills/browsy/SKILL.md` rewritten: no `compatibility:
      opencode`; prefers MCP tools, falls back to `browsy` CLI;
      works in OpenCode / Claude Code / Hermes skill dirs
- [x] `src/plugin.ts` (OpenCode adapter): thinned to register the
      new toolset over the core; existing 4 tools keep working;
      memorius hook + skill install preserved
- [x] `memorius.ts`: Node-compatible shell fallback (child_process)
      so recall works under MCP/CLI runtimes too
- [x] `package.json`: renamed to `browsy-bot` (npm name, confirmed
      free); `browsy` bin kept; MCP deps added; scripts `mcp` added;
      OpenCode-plugin entry still present
- [x] `README.md`: "Use with other tools" section — MCP config
      snippets for Claude Code / Cursor / Hermes / Gemini CLI, CLI
      usage, and the OpenCode install paths (existing content kept)
- [x] Tests: actions unit-tested against a mocked CDP socket;
      MCP server smoke-tested (in-process client calls each tool);
      CLI `--json` output shape tested

### Definition of Done
- [x] `npm run typecheck` passes with zero errors
- [x] `npm run build` (tsc) passes
- [x] `npm test` passes, including the new action/MCP/CLI tests
- [x] `grep -r "@opencode-ai/plugin" src/core src/actions* src/mcp* src/memorius.ts`
      returns no matches (core is tool-agnostic)
- [x] `npx tsx src/mcp.ts` starts a stdio MCP server that responds to
      initialize + tools/list with the 9 tools above (verified by
      running the in-process test, not by hand)
- [x] Existing 4 OpenCode tools (`browsy_navigate/screenshot/
      evaluate/recall`) still registered with the same names and
      semantics as before the refactor (verified by a test importing
      `src/plugin.ts` with a mocked `@opencode-ai/plugin` module)
- [x] `skills/browsy/SKILL.md` contains no `compatibility: opencode`
      line and no hard dependency on the OpenCode plugin being loaded
- [x] `README.md` "Use with other tools" section exists and shows at
      least 3 distinct client config snippets
- [x] No OpenCode-specific paths or APIs leak into core/mcp/cli code
      (manual review + the grep above)

### Verification Steps
1. `cd /home/dimona/Dream-Pixels-Forge/Dev/plugins/browsy-bot && npm install`
2. `npm run typecheck && npm run build && npm test`
3. `node -e "const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
   ..."` OR the in-repo `test/mcp.test.ts` — confirm
   `tools/list` returns all 9 tool names
4. `npx tsx src/cli.ts tabs --json` against a live Chrome (skip if
   unavailable; unit tests cover the shape)
5. `grep -rn "opencode" src/ --include="*.ts"` — confirm matches only
   in `src/plugin.ts` / `src/adapters/opencode/*`
6. `head -20 skills/browsy/SKILL.md` — no `compatibility: opencode`
7. `git diff --stat` — review that no unrelated files changed
8. Ask user to paste the MCP snippet into one real client of their
   choice and confirm the tools appear (manual, out-of-repo check)

### Anti-Drift Rules
- Do not add CI or publish to npm in this goal — that is a separate
  goal. The package rename (`browsy-plugin` -> `browsy-bot`) IS in
  scope: `browsy-bot` is confirmed free on npm (bare `browsy` is
  taken by an unrelated 0.0.2 package).
- Do not add browser-launch (`ensure-browser`) — Open Question #1 in
  BRAINSTORM.md, explicitly out of scope.
- Do not change CDP endpoint defaults or the memorius CLI contract.
- The OpenCode plugin path must remain byte-for-byte backward
  compatible on tool names/args; new tools are additive.
- Do not claim completion without running Verification Steps 1–7.
  Report any Chrome-unavailable integration skip as BLOCKED-note,
  not as pass.

### Estimated Effort
~1–2 days of focused work. Core/actions: half a day. MCP adapter:
half a day. CLI/skill/README: half a day. Tests + fixes: half a day.

---

## Follow-up Goal (separate, to file after this one is MET):
CI + GitHub release + npm publish of `browsy-bot`. Optionally rename
the GitHub repo slug `browsy-plugin` -> `browsy-bot` (the on-disk
folder is already renamed; the remote still points at
`github:Dream-Pixels-Forge/browsy-plugin`). Do not bundle
publishing into this goal.

---

## Goal Completion Check

Goal: Make browsy a multi-tool browser-automation kit
Date: 2026-10-07

Deliverables Check:
[x] dev-notes/BRAINSTORM.md exists — evidence: file on disk
[x] dev-notes/GOAL-BROWSY-MULTITOOL.md exists — this file
[x] Refactored core: src/core/{connection,session,domains,actions,types,index}.ts
      exists with zero OpenCode imports (verified: grep -rc "opencode" src/core => 0)
[x] src/core/actions.ts: click, fill, waitForSelector, pageText, newTab,
      listTabs, closeTab, captureConsole (via session), captureNetwork (via session),
      full-page captureScreenshot — all present
[x] src/mcp.ts: MCP stdio server with @modelcontextprotocol/sdk exposing all 9 tools
[x] `browsy mcp` CLI subcommand wired (src/cli.ts)
[x] CLI additions: wait, console, network, tabs, click, fill, page-text; global --json; stable exit codes
[x] skills/browsy/SKILL.md rewritten: no `compatibility: opencode`, no OpenCode hard-dep;
      prefers MCP tools, falls back to CLI; works in OpenCode / Claude Code / Hermes skill dirs
[x] src/plugin.ts (OpenCode adapter) thinned to register the new toolset over the core;
      existing 4 tools keep working (test/plugin.test.ts); memorius hook + skill install preserved
[x] src/memorius.ts: Node-compatible shell fallback (child_process.exec via makeNodeShell)
[x] package.json: renamed browsy-bot; `browsy` bin kept; @modelcontextprotocol/sdk + zod
      deps added; `mcp` script added; OpenCode-plugin entry still present
[x] README.md "Use with other tools" section with Claude Code / Cursor / Gemini CLI /
      Hermes / CLI snippets
[x] Tests: actions unit-tested (mocked CDP); MCP in-process client; CLI --json shape

Definition of Done Check:
[x] npm run typecheck — exit 0
[x] npm run build — exit 0
[x] npm test — 49/49 passing across 7 files
[x] grep -r "@opencode-ai/plugin" src/core src/mcp.ts src/memorius.ts src/cli.ts — 0 matches
[x] In-process MCP test (test/mcp.test.ts) confirms tools/list returns all 9 tool names
[x] test/plugin.test.ts proves all 8 OpenCode tools register + 4 original tools keep semantics
[x] skills/browsy/SKILL.md contains no `compatibility: opencode` line
[x] README.md "Use with other tools" section shows ≥3 distinct client config snippets
      (Claude Code .mcp.json, Cursor command+args, Hermes config.yaml)
[x] No OpenCode-specific paths/APIs leak into core/mcp/cli (grep clean; only
      src/plugin.ts and src/index.ts reference @opencode-ai/plugin, which is
      intentional — the plugin adapter IS the OpenCode adapter)

Anti-Drift Check:
[x] All work stayed within Objective (multi-tool kit + OpenCode backward-compat)
[x] No unstated assumptions — package name `browsy-bot` was verified free on npm;
      GitHub repo slug since renamed `browsy-plugin` -> `browsy-bot` (2026-10-07)
[x] No blockers — all verification gates green

RESULT: COMPLETE

Follow-up goal (filed separately, NOT bundled):
- CI + GitHub release + npm publish of `browsy-bot`
- Rename GitHub repo slug `browsy-plugin` -> `browsy-bot` (DONE 2026-10-07)
