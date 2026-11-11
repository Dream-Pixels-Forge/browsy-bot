# GOAL-BROWSY-V030

## Goal: v0.3.0 — Core interaction gaps (dialogs, uploads, downloads, network idle)

### Objective
Ship dialog handling, file upload, file download, and waitForNetworkIdle directly
over CDP — no middleware. These are the four most-requested primitives teams
currently need Playwright/Puppeteer for.

### Context
Tier 1 (v0.2.x) closed the multi-tool gaps. v0.3.0 closes the interaction gaps:
pages trigger `alert`/`confirm`/`prompt`, need `<input type="file">` uploads,
start downloads, or navigate SPAs that settle via network idle rather than DOM
presence.

### Deliverables
- [ ] src/core/dialogs.ts — accept/dismiss/getText via Page.javascriptDialogOpening
- [ ] src/core/upload.ts — setFileInput via DOM.resolveNode + DOM.setFileInputFiles
- [ ] src/core/download.ts — Browser.setDownloadBehavior, capture downloads to disk
- [ ] src/core/idle.ts — waitForNetworkIdle tracking Network events
- [ ] src/actions.ts — wire into public action surface
- [ ] src/mcp.ts — browsy_dialog, browsy_upload, browsy_download, browsy_wait_idle
- [ ] src/cli.ts — browsy dialog/upload/download/wait-idle commands
- [ ] Tests: test/dialogs.test.ts, test/upload.test.ts, test/download.test.ts, test/idle.test.ts
- Done when: npm run typecheck && npm run build && npm test all green
