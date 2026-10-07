# GOAL-BROWSY-TIER1.md

## Goal: Browsy Tier 1 — doctor, extract, ensure-browser, trusted input

### Objective
Ship the four Tier-1 features recommended for browsy: a `doctor`
diagnostics command, a structured `extract` data-primitive, an
`ensure-browser`/`stop-browser` lifecycle pair, and CDP trusted-input
paths for click/fill (`Input.dispatchMouseEvent` / `Input.insertText`).

### Context
The multi-tool + publish goals are complete (commits through 72002fb).
Feature brainstorm (message history, 2026-10-07) ranked Tier 1 as the
next build order: doctor + extract first (small, high-payoff), then
ensure-browser, then Input-domain hardening (most test-touching, last).
These close real gaps: onboarding friction (manual Chrome launch),
the "data extraction" use case shipped only as "write your own
evaluate", and click/fill currently being JS-dispatched (untrusted
events) rather than renderer-trusted CDP input.

### Deliverables
- [x] `src/core/diagnostics.ts` — `doctor(browserUrl, options?)`
      returning a structured `DoctorReport`: endpoint reachability
      (`/json/version` + target count), browser binary discovery,
      memorius availability, actionable suggestions. Injectable probes
      for testing (no network in unit tests).
- [x] `src/core/extract.ts` — `extract(session, selector, fields,
      options?)`: in-page structured pull. Field specs: `text`,
      `html`, `textContent`, `value`, or `attr:<name>`. Returns
      `Record<string, unknown>[]` (all matches, capped by
      `options.limit`).
- [x] `src/core/browser.ts` — browser lifecycle:
      `findBrowserBinary(explicit?)`, `buildBrowserArgs(options)`
      (pure/testable), `launchBrowser(options)` (spawn detached,
      dedicated user-data-dir, write pidfile, poll `/json/version`
      until ready), `stopBrowser(options)` (pidfile),
      `ensureBrowser(options)` (probe first, launch if down).
- [x] `src/core/actions.ts` — trusted input: `click`/`fill` gain an
      optional `{ trusted?: boolean }` flag; trusted path scrolls the
      element into view, measures its **viewport** rect via
      `Runtime.evaluate` (getBoundingClientRect — the coordinate space
      `Input.dispatchMouseEvent` expects; DOM.getBoxModel returns
      *layout* coords and would dispatch to the wrong place when
      scrolled), then issues `Input.dispatchMouseEvent`
      (mousePressed/mouseReleased at the element center). Trusted
      `fill` focuses the element (focus + select) then issues
      `Input.insertText` so frameworks see a trusted input event.
      JS-dispatch path (default) unchanged for backward compatibility.
- [x] CLI: `browsy doctor [--json]`, `browsy extract <selector>
      [field...] [--json]`, `browsy ensure-browser [--port N]
      [--binary PATH] [--no-headless]`, `browsy stop-browser`,
      `browsy click <selector> [--trusted]`, `browsy fill <s> <v>
      [--trusted]`.
- [x] Tests: `test/diagnostics.test.ts`, `test/extract.test.ts`,
      `test/browser.test.ts`; trusted-input cases appended to
      `test/actions.test.ts`.
- [x] README: Features + CLI + a short "Browser lifecycle" note
      (dedicated profile dir, `stop-browser`), Security section
      updated to reflect that ensure-browser uses a scoped profile.

### Definition of Done
- [x] `npm run typecheck` exit 0, `npm run build` exit 0
- [x] `npm test` all pass, including the new test files
- [x] `browsy doctor --json` against a stubbed endpoint produces the
      DoctorReport shape (unit test, injected probes)
- [x] `extract` with a mocked CDP connection returns the documented
      record shape (unit test)
- [x] `buildBrowserArgs` is a pure function covered by unit tests;
      `findBrowserBinary` respects explicit arg > `BROWSY_BROWSER_BINARY`
      > platform candidates (unit test with a fake binary path)
- [x] Trusted `click` issues DOM.getBoxModel + Input.dispatchMouseEvent
      (asserted via mocked connection, unit test); trusted `fill`
      issues Input.insertText
- [x] Default (non-trusted) click/fill behavior is byte-identical to
      pre-change (existing actions tests still pass unmodified)
- [x] No OpenCode imports in `src/core/**` (grep gate)
- [x] README claims match shipped behavior

### Verification Steps
1. `npm run typecheck && npm run build && npm test`
2. `node dist/cli.js doctor --help` (arg surface correct)
3. `node dist/cli.js extract --help`
4. `grep -rn "opencode\|@opencode" src/core/` → no matches
5. Read `test/diagnostics.test.ts`, `test/extract.test.ts`,
   `test/browser.test.ts` results — assert real exit codes

### Anti-Drift Rules
- Do NOT change the default click/fill path (JS dispatch) — the
  trusted path is opt-in only.
- Do NOT add an MCP tool for these in this goal (adapter wiring is a
  follow-up; core + CLI + library are the surface here).
- Do NOT shell out to platform-specific kill/ps fallbacks;
  stop-browser uses the pidfile only (documented limitation).
- ensure-browser never touches the user's default Chrome profile —
  always a dedicated user-data-dir (Security requirement).
- Do NOT add new runtime dependencies (child_process + ws + http
  only).
- Do NOT claim completion without running Verification Steps 1–5.

### Estimated Effort
~4h: doctor 1h, extract 1h, browser lifecycle 1.5h, trusted input
+ tests 0.5h, README 0.5h.
