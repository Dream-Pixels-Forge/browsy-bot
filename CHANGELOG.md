# Changelog

All notable changes to browsy-bot are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-12

### Added
- **Cookie management**: `browsy_get_cookies`, `browsy_set_cookies`, `browsy_delete_cookies` (MCP); `browsy get-cookies`, `browsy set-cookies`, `browsy delete-cookies` (CLI). Cookie management via CDP's `Network` domain — domain-scoped cookies with optional path.
- **Storage management**: `browsy_get_storage` (MCP); `browsy get-storage` (CLI). Read `localStorage` + `sessionStorage` for the page's current origin via `Runtime.evaluate`.
- **Structural visual diff**: `browsy_capture_dom`, `browsy_diff_dom` (MCP); `browsy capture-dom`, `browsy diff-dom` (CLI). DOM-structure comparison — more robust than pixel diff for dynamic content, animations, anti-aliasing, and timestamps.
- **Mobile emulation**: `browsy_emulate_device`, `browsy_set_geolocation`, `browsy_set_device_orientation` (MCP); `browsy emulate-device`, `browsy set-geolocation`, `browsy set-device-orientation` (CLI). Device presets: iPhone 15, iPhone 15 Pro Max, iPad Air, Pixel 8, Galaxy S24.
- **Performance metrics**: `browsy_performance` (MCP); `browsy performance` (CLI). Core Web Vitals (LCP, CLS, INP, FCP) and navigation timing via CDP `Performance` domain.
- **Retry resilience**: `browsy_retry` (MCP); `browsy retry` (CLI). Exponential backoff with optional screenshot-on-retry to `dev-notes/browsy-captures/retries/`.
- **Iframe/frame handling**: `browsy_enter_frame`, `browsy_exit_frame` (MCP); `browsy enter-frame`, `browsy exit-frame` (CLI). Resolve iframe via DOM + `Page.getFrameTree`, switch focus via `Page.setFocusedFrame`.
- **Request interception**: `browsy_intercept` (MCP); `browsy intercept` (CLI). Block or mock network requests via `Network.setBlockedURLs` / `Fetch.fulfillRequest`.
- **Accessibility audit**: `browsy_a11y` (MCP); `browsy a11y` (CLI). Return the live accessibility tree simplified to role/name/value/state per node.
- **Visual regression**: `browsy_visual_baseline`, `browsy_visual_compare` (MCP); `browsy visual-baseline`, `browsy visual-compare` (CLI). Pixel-diff screenshots against saved baselines.
- **Record & replay**: `browsy_record`, `browsy_replay` (MCP); `browsy record`, `browsy stop-recording`, `browsy replay` (CLI). Serialize CDP sessions to NDJSON for offline debugging.
- **Stealth mode**: `browsy_stealth` (MCP); `browsy stealth` (CLI). Inject anti-detection script (`navigator.webdriver`, plugins, languages, WebGL, chrome object).
- **Cross-tab coordination**: `browsy_track_tabs`, `browsy_switch_tab` (MCP); `browsy track-tabs`, `browsy switch-tab` (CLI). Auto-discover popups and `target=_blank` links.
- **Dialogs**: `browsy_dialog` (MCP); `browsy dialog` (CLI). Accept/dismiss/read JavaScript dialogs (alert/confirm/prompt).
- **File upload**: `browsy_upload` (MCP); `browsy upload` (CLI). Set files on `<input type="file">` via `DOM.setFileInputFiles`.
- **File download**: `browsy_download` (MCP); `browsy download` (CLI). Configure `Browser.setDownloadBehavior` with allow/deny.
- **Network idle**: `browsy_wait_idle` (MCP); `browsy wait-idle` (CLI). Wait until no in-flight requests for a configurable idle window.
- **Preflight health check**: `browsy doctor` now runs a preflight check before captures — endpoint reachability + at least one page target, with actionable issue messages.
- **Auto-save screenshots**: `browsy_screenshot` / `browsy screenshot` auto-save timestamped PNGs to `dev-notes/browsy-captures/` (opt-in via `BROWSY_AUTOSAVE_CAPTURES=1`).
- **CI validation workflow**: `.github/workflows/browsy-validate.yml` — runs `browsy doctor`, captures screenshots on failure, uploads `dev-notes/browsy-captures/` as workflow artifacts.
- **Semantic versioning**: v1.0.0 release with semver tag, changelog, and npm publish with provenance.
- **License**: MIT License added.

### Changed
- Version bumped to `1.0.0` in `package.json`.
- README rewritten with full feature inventory and npm badges.
- Docs site updated with v1.0.0 version badge and expanded feature grid.
- All dev-notes subgoals marked complete (v0.3.0 through v1.0.0).

## [0.2.1] - 2026-10-XX

### Changed
- Browsy MCP server + CLI screenshots auto-save to `dev-notes/browsy-captures/` (opt-in via `BROWSY_AUTOSAVE_CAPTURES`).
- Preflight health check added to `browsy doctor` — runs before captures.

## [0.2.0] - 2026-10-XX

### Added
- Multi-tool architecture: OpenCode plugin (8 tools), MCP server (9 tools), CLI.
- Structured extraction (`browsy extract`).
- Browser lifecycle (`browsy ensure-browser`, `browsy stop-browser`).
- Trusted input (`--trusted` flag for click/fill).
- Diagnostics (`browsy doctor`).

## [0.1.0] - 2026-10-XX

### Added
- Initial release: navigate, screenshot, evaluate, click, fill, wait, console, network_log, list_tabs, new_tab, close_tab, page_text, extract.
