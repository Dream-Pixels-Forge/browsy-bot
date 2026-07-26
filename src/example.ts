// Example Browsy Usage
// Demonstrates core CDP capabilities for OpenCode integration.
//
// Prerequisites: a Chrome/Chromium instance running with remote debugging:
//   chromium --remote-debugging-port=9222 --headless --no-sandbox

import { createBrowsy, navigate, captureScreenshot, evaluate } from './index.js';

async function demo() {
  console.log('[browsy] Starting browser automation demo...');

  // One-shot convenience helpers open/close a temporary connection per call.
  await navigate('ws://localhost:9222', 'https://example.com');
  console.log('[browsy] Navigated to example.com');

  const screenshotData = await captureScreenshot('ws://localhost:9222', {
    format: 'png',
  });
  console.log(`[browsy] Captured screenshot (${screenshotData.length} bytes)`);

  const result = await evaluate('ws://localhost:9222', 'document.title');
  console.log(`[browsy] Page title: ${JSON.stringify(result)}`);

  // Persistent Browsy instance — domains are available after connect().
  const browsy = createBrowsy('ws://localhost:9222');
  try {
    await browsy.connect();
    console.log('[browsy] Connected; isConnected =', browsy.isConnected);
    const metrics = await browsy.performance.getMetrics();
    console.log('[browsy] Performance metrics:', metrics);
  } finally {
    await browsy.close();
    console.log('[browsy] Connection closed');
  }
}

demo().catch((error: Error) => {
  console.error('[browsy] Demo failed:', error.message);
  process.exit(1);
});