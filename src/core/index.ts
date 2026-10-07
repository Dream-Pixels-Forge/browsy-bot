// Browsy CDP core — tool-agnostic. No OpenCode imports anywhere in this tree.
//
// Layout:
//   types.ts      CDP message types, domain param/result interfaces
//   connection.ts  raw CDP WebSocket connection + one-shot helpers
//   domains.ts     Page/Runtime/Performance/Accessibility/Target wrappers
//   session.ts     cached long-lived connection + console/network capture
//   actions.ts     click / fill / waitForSelector / pageText / screenshots
//   extract.ts     structured data pull (query-selector -> record[])
//   diagnostics.ts `doctor` — endpoint / binary / memorius probes
//   browser.ts     ensure-browser / stop-browser lifecycle

export * from './types.js';
export * from './connection.js';
export * from './domains.js';
export * from './session.js';
export * from './actions.js';
export * from './extract.js';
export * from './diagnostics.js';
export * from './browser.js';
