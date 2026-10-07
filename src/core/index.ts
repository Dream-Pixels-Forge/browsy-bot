// Browsy CDP core — tool-agnostic. No OpenCode imports anywhere in this tree.
//
// Layout:
//   types.ts      CDP message types, domain param/result interfaces
//   connection.ts  raw CDP WebSocket connection + one-shot helpers
//   domains.ts     Page/Runtime/Performance/Accessibility/Target wrappers
//   session.ts     cached long-lived connection + console/network capture
//   actions.ts     click / fill / waitForSelector / pageText / screenshots

export * from './types.js';
export * from './connection.js';
export * from './domains.js';
export * from './session.js';
export * from './actions.js';
