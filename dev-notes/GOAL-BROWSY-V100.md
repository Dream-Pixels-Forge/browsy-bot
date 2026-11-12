# GOAL-BROWSY-V100

## Goal: v1.0.0 — Cookie/Storage management + 1.0 release

### Objective
Add cookie and storage management so browsy-bot can maintain authenticated
sessions across captures, plus ship the 1.0.0 release.

### Context
browsy-bot starts every capture fresh — no auth persistence. CDP's Network
and Storage domains let us get/set/delete cookies and inspect storage,
enabling logged-in E2E flows (dashboards, checkout, etc.).

### Deliverables
- [ ] src/core/cookies.ts — getCookies/setCookies/deleteCookies
- [ ] src/core/storage.ts — getStorage per origin
- [ ] src/core/actions.ts — re-export
- [ ] src/mcp.ts — browsy_get_cookies, browsy_set_cookies, browsy_delete_cookies, browsy_get_storage
- [ ] src/cli.ts — browsy get-cookies, browsy set-cookies, browsy delete-cookies, browsy get-storage
- [ ] Tests: cookies.test.ts, storage.test.ts, mcp.test.ts integration
- [ ] Release: v1.0.0 tag, changelog, README, npm publish
- Done when: typecheck + build + tests green + release published
