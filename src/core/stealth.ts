// Stealth mode — anti-detection for headless CDP browsers.
//
// Injects a script on every new document via
// `Page.addScriptToEvaluateOnNewDocument` that neutralizes common
// headless detection signals:
//   - navigator.webdriver → undefined
//   - navigator.plugins → non-empty array
//   - navigator.languages → ['en-US', 'en']
//   - WebGL renderer/vendor → non-headless values
//   - chrome object → present
//
// Best-effort: Page.enable failures are swallowed so a single already-
// enabled session doesn't break the call.

import { CDPConnection } from './connection.js';
import type { Session } from './session.js';

type Conn = CDPConnection;

/** Script injected into every new page document to mask headless signals. */
const STEALTH_SOURCE = `
(() => {
  // navigator.webdriver
  try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch {}
  // navigator.plugins
  try { Object.defineProperty(navigator, 'plugins', { get: () => [ { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' } ] }); } catch {}
  // navigator.languages
  try { Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); } catch {}
  // WebGL renderer / vendor
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };
  } catch {}
  // chrome object
  try { if (!window.chrome) window.chrome = { runtime: {} }; } catch {}
})();
`;

/** Enable stealth mode on the session's page connection. */
export async function enableStealth(session: Session): Promise<void> {
  const conn = await session.page();
  try {
    await conn.send('Page.enable');
  } catch {
    // best-effort: Page may already be enabled
  }
  await conn.send('Page.addScriptToEvaluateOnNewDocument', {
    source: STEALTH_SOURCE,
  });
}
