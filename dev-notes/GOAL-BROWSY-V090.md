# GOAL-BROWSY-V090

## Goal: v0.9.0 — Structural visual diff

### Objective
Add DOM-structure visual diff that compares two page snapshots structurally
(tag names, attributes, text content, element counts) rather than pixel-by-pixel.
More robust than pixel diff for dynamic content.

### Context
browsy-bot has pixel-based visual regression (v0.4.0). Pixel diff is brittle
(fonts, sub-pixel, animations, timestamps). Structural DOM diff captures real
regressions without noise.

### Deliverables
- [ ] src/core/dom-diff.ts — captureDomSnapshot, diffDomSnapshots, compareDom
- [ ] src/core/actions.ts — re-export
- [ ] src/mcp.ts — browsy_capture_dom, browsy_diff_dom
- [ ] src/cli.ts — browsy capture-dom, browsy diff-dom
- [ ] Tests: test/dom-diff.test.ts, tools in mcp.test.ts
- Done when: npm run typecheck && npm run build && npm test all green
