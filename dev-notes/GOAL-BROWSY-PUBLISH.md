# GOAL-BROWSY-PUBLISH.md

## Goal: Ship browsy-bot to npm + CI + GitHub release pipeline

### Objective
Make `browsy-bot` publishable to npm and gated by a CI pipeline that
runs typecheck/build/test before any publish, so `npm i -g browsy-bot`
produces a working `browsy` binary under Node.

### Context
Follow-up to `GOAL-BROWSY-MULTITOOL.md` (completed 2026-10-07, audit MET).
The multi-tool goal was explicitly scoped to NOT include publishing.
This goal closes that gap. The `dist/` build is confirmed
Node-executable (`node dist/cli.js --help` works); what's missing is
the npm packaging layer + CI + release trigger.

### Deliverables
- [ ] `package.json`: `bin` → `./dist/cli.js`; `main`/`types` →
      `./dist/index.js` / `./dist/index.d.ts`; `exports` → Node +
      TS-dual mapping to `dist/`; `files` = `["dist","skills","README.md"]`;
      `repository` field; `publishConfig.access = "public"`;
      `prepublishOnly` → `npm run build`; add `version` stays `0.1.0`.
- [ ] `.github/workflows/ci.yml`: on `pull_request` + `push` to main —
      npm ci, typecheck, build, test (all required to pass).
- [ ] `.github/workflows/release.yml`: on tag `v*` — npm ci, typecheck,
      build, test, then `npm publish` (token-based, `NPM_TOKEN` secret;
      OIDC noted as a follow-up). Tagging `v0.1.0` publishes `0.1.0`.
- [ ] `npm pack` dry-run (locally) produces a tarball whose `bin` is
      `dist/cli.js` and whose `files` are limited to dist/skills/README.
- [ ] Optional: rename GitHub repo slug `browsy-plugin` →
      `browsy-bot` (user's call — do NOT do silently).
- [ ] `dev-notes/GOAL-BROWSY-PUBLISH.md` — this file, checked off as
      items land.

### Definition of Done
- [ ] `npm pack --dry-run` shows `bin: dist/cli.js` and
      `files: dist, skills, README.md, package.json, tsconfig.json`.
- [ ] `package.json` has no `.ts` reference in `main`, `bin`, or
      `exports` (all `.js`/`.d.ts` under `dist/`).
- [ ] `.github/workflows/ci.yml` exists and its job runs
      `npm run typecheck && npm run build && npm test` — verified by
      reading the file (CI itself needs a push to actually run).
- [ ] `.github/workflows/release.yml` exists and its job publishes via
      `npm publish` with `NODE_AUTH_TOKEN`/`NPM_TOKEN`.
- [ ] `npm whoami` or equivalent confirms a working npm token BEFORE
      the user triggers the tag (if not, report as BLOCKED-note).
- [ ] No source changes under `src/` in this goal — packaging only.

### Verification Steps
1. `npm run build && npm pack --dry-run | tail -30` — tarball shape sane.
2. `node dist/cli.js --version` → prints `0.1.0`.
3. `npm pack && tar -tzf browsy-bot-0.1.0.tgz | head` — file list correct.
4. `git diff --name-only` — confirm no `src/` files touched.
5. User pushes tag `v0.1.0` (or runs `npm publish` manually) → the
   final `npm view browsy-bot` is out-of-repo; report as MANUAL-NOTE.

### Anti-Drift Rules
- Do NOT rename the GitHub repo slug without user confirmation.
- Do NOT change source code (`src/`, `test/`) — this is a packaging
  and CI goal only.
- Do NOT commit or push the npm token into the repo.
- If `npm whoami` is 401, report as BLOCKED-note and let the user
  fix auth before the release workflow is expected to fire.
- Do NOT bundle the OIDC setup into this goal (separate follow-up).

### Estimated Effort
~30 min. package.json edits: 5 min. ci.yml: 10 min. release.yml: 10 min.
npm pack verification: 5 min.
