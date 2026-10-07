# GOAL-BROWSY-GITHUB-PAGE.md

## Goal: Browsy-bot modern premium GitHub Pages site in `docs/`

### Objective
Design, build, and publish a modern, premium, single-page GitHub Pages
landing site for `browsy-bot`, authored entirely inside the `docs/`
folder, live at `https://dream-pixels-forge.github.io/browsy-bot/`.

### Context
`browsy-bot` v0.2.0 is a zero-middleware CDP browser-automation kit with
three adapters (OpenCode plugin, universal MCP server, CLI) and Tier-1
features (`doctor`, `extract`, `ensure-browser`/`stop-browser`,
`--trusted` input). It currently has no website. The user wants a
polished public landing page, not a raw README dump.

Repo/plan facts (verified 2026-10-07):
- Repo `Dream-Pixels-Forge/browsy-bot`, default branch `main`,
  **public**, free plan → GitHub Pages is usable (no account-level gate).
- Pages not enabled yet.
- Reusable brand asset: `assets/banner.png` (2172×724, ~1.3MB).

Design requirements (standing user preference — premium/professional,
no emoji on landing pages):
- **Dark theme**, refined typography, subtle micro-interactions.
- **No emoji.** Feature/card icons are custom inline SVG (stroke-based,
  24px grid), not emoji or icon-font glyphs.
- Responsive (mobile → desktop). Single self-contained `index.html`
  (inline `<style>` + small vanilla `<script>` for nav/scroll/syntax
  highlight); no build step, no framework, no CDN JS dependency that
  could break offline.
- Content reflects shipped v0.2.0 behavior only (no invented features).

### Deliverables
- [ ] `docs/index.html` — the full landing page (hero, feature grid,
      three-adapter section, Tier-1 feature section, quick-start code
      examples, security note, footer with license + repo link).
- [ ] `docs/.nojekyll` — empty file to disable Jekyll processing.
- [ ] `docs/assets/banner.png` — copy of the repo banner used in the hero
      (kept local so the deployed site is self-contained).
- [ ] `docs/404.html` — minimal premium-styled 404 (links back to `/`).
- [ ] `.github/workflows/pages.yml` — canonical GitHub Actions Pages
      deploy workflow (`actions/configure-pages@v5` with
      `enablement: true`, `actions/upload-pages-artifact@v3` with
      `path: docs`, `actions/deploy-pages@v4`; `concurrency: pages`
      with `cancel-in-progress: false`; trigger on push to `main`
      matching `docs/**` + the workflow file; `permissions:
      contents:read, pages:write, id-token:write`).
- [ ] `README.md` — add a "Live site" link to
      `https://dream-pixels-forge.github.io/browsy-bot/` near the top
      (below the banner/hero block).

### Definition of Done
- [ ] All six deliverable files exist at their exact paths.
- [ ] Local serve check passes: `cd docs && python3 -m http.server`
      + `curl http://127.0.0.1:<port>/index.html` returns HTTP 200.
- [ ] `docs/index.html` contains **zero emoji characters** and at least
      4 custom inline `<svg>` icons; has a `meta name="viewport"` tag.
- [ ] `.github/workflows/pages.yml` parses as valid YAML
      (`python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/pages.yml'))"`
      exit 0) and includes `enablement: true` + `path: docs`.
- [ ] After push, `gh run list --workflow=pages.yml --limit 1` shows a
      **successful** run.
- [ ] `gh api repos/Dream-Pixels-Forge/browsy-bot/pages --jq .html_url`
      returns `https://dream-pixels-forge.github.io/browsy-bot`.
- [ ] `curl -s -o /dev/null -w "%{http_code}"
      https://dream-pixels-forge.github.io/browsy-bot/` returns 200.
- [ ] README links the live site URL.

### Verification Steps
1. **Local render** — `cd docs && python3 -m http.server 8913 &` then
   `curl -s -o /dev/null -w "%{http_code}\n"
   http://127.0.0.1:8913/index.html` → expect `200`. Kill the server
   after. (Optional: browser screenshot for a visual pass on hero,
   feature grid alignment, and install-command visibility.)
2. **Design gate** — `grep -nP '[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}]'
   docs/index.html` → no matches (no emoji). Confirm
   `grep -c '<svg' docs/index.html` ≥ 4 and
   `grep -c 'name="viewport"' docs/index.html` = 1.
3. **YAML gate** — `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/pages.yml'))"
   && echo OK` → exit 0.
4. **Publish** — commit `docs/`, the workflow, and the README link; push
   to `main`. `gh run list --workflow=pages.yml --limit 3` → wait for a
   green run (first run can take 2–3 min).
5. **Live check** — `gh api repos/Dream-Pixels-Forge/browsy-bot/pages
   --jq .html_url` and `curl -s -o /dev/null -w "%{http_code}\n"
   https://dream-pixels-forge.github.io/browsy-bot/` → both expected.

### Anti-Drift Rules
- Docs-only change + one workflow file + one README link. Do **not**
  touch `src/`, `test/`, `package.json`, or the existing `ci.yml` /
  `release.yml`.
- No JS framework, bundler, or build step — plain HTML/CSS/JS so the
  site deploys as-is from `docs/`.
- No emoji anywhere on the page; icons are custom inline SVG.
- Content claims must match shipped v0.2.0 behavior (cross-check
  `README.md` before writing copy); do not invent features.
- If the `pages.yml` deploy is blocked or the live URL 404s after a
  green run, stop and report the blocker — do not silently fall back to
  the Settings-based "deploy from branch" UI without saying so.
- Do not claim completion without running Verification Steps 1–5.

### Estimated Effort
~2–3h: design + build the page (1.5h), wire the workflow + README (0.5h),
publish + live verification (0.5h).
