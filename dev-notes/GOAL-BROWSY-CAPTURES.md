# GOAL-BROWSY-CAPTURES

## Goal: Auto-store screenshots in dev-notes/browsy-captures + preflight issue detection

### Objective
Screenshots taken while browsy works on a project can be saved to
`<project>/dev-notes/browsy-captures/` (timestamped PNG) while still
returning the base64 payload. Auto-save is **opt-in by user permission**
(BROWSY_AUTOSAVE_CAPTURES=1|true|yes|on) — it never writes to disk without
explicit consent, and write failures never crash the call. A lightweight
preflight health check runs before captures so connection/target problems
surface as actionable issues instead of cryptic CDP failures.

### Context
Auto-writing to a user's project directory is a side effect that requires
consent. Without permission, screenshots return base64 only (unchanged
behavior) unless an explicit `outputPath`/`--output` is given.

### Deliverables
- [x] `src/core/capture.ts` — `findProjectRoot`, `ensureCapturesDir`,
      `captureFileName`, `writeScreenshot`, `mayAutosave` (permission gate),
      `tryAutoSave` (never-throws best-effort write).
- [x] `src/core/actions.ts` — `screenshot`/`fullPageScreenshot` accept
      `outputPath` and write the file when given.
- [x] `src/core/diagnostics.ts` — `preflight(browserUrl, options?)`:
      reachable endpoint + at least one page target, injectable probes,
      actionable issue messages.
- [x] `src/mcp.ts` — `browsy_screenshot` runs preflight, auto-saves only
      when `mayAutosave()`, explicit outputPath still wins, write errors
      reported via `saveError` without failing the call.
- [x] `src/cli.ts` — `browsy screenshot` runs preflight, auto-saves only
      when `mayAutosave()`, unwritable dirs degrade gracefully.
- [x] `src/index.ts` + `src/core/index.ts` export the new surface.
- [x] Tests: test/capture.test.ts, preflight in test/diagnostics.test.ts,
      outputPath in test/actions.test.ts, permission-gated screenshot in
      test/mcp.test.ts.
- [x] Done when: `npm run typecheck && npm run build && npm test` all green.

### Risks addressed
- Auto-save asks permission via `BROWSY_AUTOSAVE_CAPTURES` env var (opt-in,
  never on by default).
- Write failures are swallowed for auto-save (read-only dirs don't crash);
  explicit `outputPath` failures still surface.
- Preflight adds one HTTP round-trip (intentional — required to catch issues early).
