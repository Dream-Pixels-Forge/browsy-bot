# TASKS.md — Browsy Multi-Tool Goal

## Epic: Make browsy tool-agnostic (not just an OpenCode plugin)

### Task 1: Core split (`src/core/`)
- Move `types.ts`, `connection.ts`, `domains.ts` into `src/core/`
- Add `src/core/session.ts` — cached long-lived CDP connection
- Add `src/core/actions.ts` — click/fill/waitForSelector/pageText/newTab/
  listTabs/closeTab/captureConsole/captureNetwork/full-page screenshot
- Add `src/core/index.ts` re-export
- **Files touched:** src/core/*, src/index.ts, src/example.ts, src/cli.ts
- **Done when:** `grep -rn "opencode" src/core` returns nothing

### Task 2: MCP adapter (`src/mcp.ts`)
- stdio MCP server via `@modelcontextprotocol/sdk`
- 9 tools: navigate, new_tab, list_tabs, screenshot, evaluate, wait,
  console, network_log, recall
- `browsy mcp` CLI subcommand
- **Files:** src/mcp.ts, package.json (deps + bin script)
- **Done when:** in-process test lists all 9 tools

### Task 3: CLI hardening (`src/cli.ts`)
- Add wait/console/network/tabs/click/fill/page-text
- Global `--json` flag + stable exit codes
- **Files:** src/cli.ts
- **Done when:** `browsy tabs --json` emits JSON

### Task 4: Node-compat memorius (`src/memorius.ts`)
- child_process fallback when no Bun `$` shell
- **Files:** src/memorius.ts
- **Done when:** recall works under Node (unit test with child_process mock)

### Task 5: Thin OpenCode plugin (`src/plugin.ts`)
- Delegate to core; keep 4 existing tools + add new ones
- Keep memorius hook + skill install
- **Files:** src/plugin.ts
- **Done when:** mocked-`@opencode-ai/plugin` test registers all tools

### Task 6: Portable skill + README
- `skills/browsy/SKILL.md`: drop `compatibility: opencode`, prefer MCP,
  fall back to CLI
- README "Use with other tools" section (3+ client snippets)
- **Files:** skills/browsy/SKILL.md, README.md
- **Done when:** no `compatibility: opencode` line; 3 client snippets

### Task 7: Tests
- actions against mocked CDP socket
- MCP in-process client smoke test
- CLI `--json` shape
- **Files:** test/actions.test.ts, test/mcp.test.ts, test/cli.test.ts

## Verification (goal DoD)
npm run typecheck && npm run build && npm test — all green.
grep gate + SKILL.md head + README section — see goal doc.
