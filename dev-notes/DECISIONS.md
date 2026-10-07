# DECISIONS.md

## 2026-10-07: npm package name -> `browsy-bot`
- **Decision:** Rename the npm package `browsy-plugin` -> `browsy-bot`.
- **Rationale:** `browsy-plugin` implies an OpenCode-only plugin; the
  project is becoming a tool-agnostic CDP kit with OpenCode as one of
  many adapters. Confirmed `browsy-bot` is free on npmjs.org
  (`npm view browsy-bot` -> 404). The bare `browsy` name is taken by an
  unrelated 0.0.2 package, so it is not usable.
- **Alternatives considered:** `browsy` (taken); keep `browsy-plugin`
  (misleading); `browsy-cdp` / `browsy-mcp` (too narrow — the kit
  ships CLI + MCP + plugin, not just one surface).
- **Impact:** `package.json` name/description updated, lockfile
  regenerated name, README npm-facing references updated. The on-disk
  folder was renamed `browsy-plugin` -> `browsy-bot` in the same pass.
  The GitHub remote/repo slug still reads `browsy-plugin` (a separate,
  optional rename the user can request via the GitHub UI / `git remote`).
  OpenCode `plugin` config now uses `browsy-bot` for the npm install path;
  GitHub-spec install paths still point at the repo.
- **Decided by:** user (requested rename; availability verified).
