# BRAINSTORM.md — Browsy: Multi-Tool Browser Automation

## Problem Statement

Browsy is currently an OpenCode-first CDP browser-automation kit: the
interesting work (raw WebSocket CDP, domain wrappers, memorius learning)
is locked behind OpenCode's plugin API (`@opencode-ai/plugin`, Bun `$`
shell, `~/.config/opencode/skills/` install path). Other coding agents
(Claude Code, Cursor, Gemini CLI, Cline, Hermes, Codex, Aider, any
MCP client) cannot use it without an OpenCode install.

Secondary problems in the core itself:

1. **Per-call socket churn.** Every convenience helper
   (`navigate`, `captureScreenshot`, `evaluate`) opens a new CDP
   WebSocket, runs one command, and closes it. A 5-step flow costs
   5 handshakes and loses all event state (console messages, network
   logs, load events) between calls.
2. **No interaction primitives.** Only `evaluate` + screenshot. No
   `click`, `fill`, `waitForSelector`, no console capture, no network
   capture, no tab management (it hijacks the first discovered tab).
3. **CLI is thin.** 4 subcommands, no JSON output, no `--json`/`--raw`
   flags, no domain-specific commands, no stable machine-readable
   contract for agents.
4. **Skill is opencode-scoped.** `SKILL.md` says `compatibility:
   opencode` and documents `browsy_*` tool names that only exist when
   the OpenCode plugin is loaded.

## Proposed Solution

**Split browsy into a tool-agnostic core + thin adapters.**

```
browsy-bot/
  src/core/        CDPConnection, domains, actions, session cache
  src/adapters/
    opencode/      the existing plugin (thinned to a wrapper)
    mcp/           NEW: stdio + HTTP MCP server  (universal unlock)
    cli/           hardened CLI                  (universal fallback)
  skills/browsy/   portable SKILL.md (tool-agnostic, CLI-first)
```

The MCP server is the primary multi-tool path: any MCP client
(Claude Code, Cursor, Gemini CLI, Cline, Continue, Zed, Hermes)
registers one stdio server and gets the full browsy toolset. The CLI
is the universal fallback for any agent with a terminal. The skill
teaches whichever tool is present. The OpenCode plugin stays as a
first-class adapter but becomes a thin registration layer over the
core.

## Architecture Vision

### Components

- **Core CDP kit** (`src/core/`): `CDPConnection` (existing, unchanged
  contract), domain wrappers, **`Session`** — a cached long-lived
  connection keyed by `(browserUrl, targetId)` that enables event
  capture (console, network, load) and cheap repeated calls.
- **Actions layer**: `click(selector)`, `fill(selector, text)`,
  `waitForSelector(selector, timeout)`, `pageText()`,
  `newTab(url)`, `listTabs()`, `closeTab(id)`, `captureConsole()`,
  `captureNetwork()`, full-page screenshot — all built on
  `Runtime.evaluate` + CDP Input/DOM/Target/Network/Log domains.
- **MCP adapter**: stdio MCP server (`browsy mcp` CLI subcommand, also
  runnable as `node dist/mcp.js`). Tools: `browsy_navigate`,
  `browsy_new_tab`, `browsy_list_tabs`, `browsy_screenshot`,
  `browsy_evaluate`, `browsy_wait`, `browsy_console`,
  `browsy_network_log`, `browsy_recall`.
- **CLI adapter**: adds `wait`, `console`, `network`, `tabs` (list /
  new / close), `click`, `fill`, `page-text`; `--json` global flag
  for machine-readable output; stable exit codes.
- **Portable skill**: `skills/browsy/SKILL.md` rewritten — no
  `compatibility: opencode`; instructs the agent to prefer MCP tools
  when registered, else use the `browsy` CLI. One skill file works in
  OpenCode, Claude Code (`~/.claude/skills`), Hermes
  (`~/.hermes/skills`), and OpenCode's own skills dir.
- **OpenCode adapter**: `src/plugin.ts` delegates to core actions;
  registers the new tools alongside the existing four; keeps
  memorius hook + skill install (best-effort, as today).

### Data Flow

Agent (any tool) → MCP stdio / CLI shell → adapter → core Session
(cached CDP socket) → Chrome DevTools Protocol → Chrome. Event
listeners (console/network) accumulate in the Session, returned on
demand. Memorius recall/remember stays opt-in and adapter-level.

### Agent Roles

- **Executor agent** (Claude Code / OpenCode / Hermes / ...): drives
  the browser for live UI validation, bug repro, data extraction,
  perf budgets, AX audits.
- **Human**: owns the Chrome instance and the CDP endpoint; browsy
  never launches a browser itself (out of scope for now — see
  Open Questions).

## Framework Selection

- **TypeScript, keep it**: the OpenCode plugin contract is TS/Bun,
  the core is TS, and MCP's official SDK is TypeScript
  (`@modelcontextprotocol/sdk`). A Go MCP server would duplicate the
  CDP client and split the codebase — rejected.
- **`@modelcontextprotocol/sdk`** for the MCP server (stdio +
  StreamableHTTP transports both).
- **`commander`** for the CLI (already a dependency).
- **No new browser layer**: no Playwright/Puppeteer — the whole point
  is zero-middleware CDP.

## Open Questions

1. **Browser lifecycle**: should browsy ever *launch* a headless
   Chrome itself (`browsy ensure-browser`)? Convenient but adds
   binary management + security surface (CDP = full control).
   Default stance: no; document the `chromium --remote-debugging-port`
   prerequisite instead.
2. **npm name: RESOLVED -> `browsy-bot`.** Confirmed free on
   npmjs.org (`browsy-bot` 404s; the bare `browsy` name is taken by an
   unrelated 0.0.2 package). The npm package is renamed
   `browsy-plugin` -> `browsy-bot`. The on-disk folder was renamed in
   the same pass; the GitHub repo slug was renamed `browsy-plugin` ->
   `browsy-bot` on 2026-10-07 (old slug redirects). The OpenCode `plugin` spec
   now references `browsy-bot` for the npm path; GitHub-spec install
   paths still point at the repo.
3. **HTTP MCP mode**: ship stdio-only first (covers every known
   client), add StreamableHTTP later for shared server setups.
4. **memorius under non-Bun runtimes**: MCP/CLI run under Node, where
   there is no `$` shell. Adapt memorius.ts to `child_process` for
   Node (behavior-preserving) or keep it OpenCode-plugin-only.

## Ranked Improvements (cross-cutting)

1. MCP server adapter — biggest reach, one config snippet per tool.
2. CLI hardening + `--json` — the zero-dependency universal path.
3. Core actions layer (click/fill/wait/tabs/console/network) — turns
   browsy from "screenshot + eval" into real browser automation.
4. Session/connection caching — removes per-call handshake churn.
5. Portable skill — one SKILL.md, every tool.
6. CI + npm publish + multi-tool README — distribution.
7. Security notes: CDP endpoint = full machine-control of the browser;
   document localhost-only default, `BROWSY_URL` risk.
