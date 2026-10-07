// High-level browser actions built on a Session's cached page connection.
//
// Each action opens/uses the session's page CDP connection, runs a CDP
// command (usually Runtime.evaluate with a self-contained in-page script,
// or a Page/Target command), and returns a typed result. All actions are
// best-effort about enabling the CDP domains they need.
//
// Design note: click/fill/waitForSelector/pageText are implemented through
// Runtime.evaluate with in-page scripts. This keeps browsy's "zero
// middleware, direct CDP" ethos — no DOM/Event domain juggling, works
// headless, and is robust for the common UI-validation cases this kit is
// built for. Pixel-accurate input (CDP Input.dispatchMouseEvent /
// Input.insertText) is intentionally not wired here; it is a natural
// follow-up and stays out of scope (see goal anti-drift rules).

import { CDPConnection } from './connection.js';
import { Page, Runtime, Target, TargetListEntry } from './types.js';
import type { Session } from './session.js';
import { createConnection, listTargets } from './connection.js';

type Conn = CDPConnection;

async function page(session: Session): Promise<Conn> {
  return session.page();
}

function quoteJs(s: string): string {
  return JSON.stringify(s);
}

function evalString(
  conn: Conn,
  expression: string,
): Promise<string> {
  return conn
    .send<{ result?: Runtime.RemoteObject; exceptionDetails?: Runtime.ExceptionDetails }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
    )
    .then((res) => {
      if (res?.exceptionDetails) {
        const d = res.exceptionDetails as Runtime.ExceptionDetails & {
          exception?: { description?: string };
        };
        throw new Error(
          d.exception?.description ?? d.text ?? 'page JS threw',
        );
      }
      const v = res?.result?.value;
      return typeof v === 'string' ? v : '';
    });
}

// --- interaction primitives ------------------------------------------------

/**
 * Click the first element matching `selector`. The in-page script queries,
 * dispatches a pointer + click sequence, and reports whether it clicked.
 */
export async function click(session: Session, selector: string): Promise<boolean> {
  const conn = await page(session);
  const script = `
    (() => {
      const el = document.querySelector(${quoteJs(selector)});
      if (!el) { JSON.stringify({ clicked: false, error: 'selector not found' }); }
      el.focus?.();
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      el.click();
      JSON.stringify({ clicked: true, tag: el.tagName });
    })()
  `;
  const raw = await evalString(conn, script);
  let out: { clicked: boolean; tag?: string; error?: string };
  try {
    out = JSON.parse(raw || '{}');
  } catch {
    out = { clicked: false, error: raw };
  }
  return out.clicked;
}

/**
 * Set the value of a form control matching `selector` and fire the input
 * events most frameworks listen for.
 */
export async function fill(
  session: Session,
  selector: string,
  value: string,
): Promise<boolean> {
  const conn = await page(session);
  const script = `
    (() => {
      const el = document.querySelector(${quoteJs(selector)});
      if (!el) { JSON.stringify({ filled: false, error: 'selector not found' }); }
      el.focus?.();
      el.value = ${quoteJs(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      JSON.stringify({ filled: true, tag: el.tagName });
    })()
  `;
  const raw = await evalString(conn, script);
  let out: { filled: boolean; tag?: string; error?: string };
  try {
    out = JSON.parse(raw || '{}');
  } catch {
    out = { filled: false, error: raw };
  }
  return out.filled;
}

export interface WaitForOptions {
  /** Poll interval in ms. Defaults to 100. */
  intervalMs?: number;
  /** Max total wait in ms before throwing. Defaults to 10000. */
  timeoutMs?: number;
}

/**
 * Poll until an element matching `selector` exists in the DOM. Resolves when
 * found; throws when the timeout elapses.
 */
export async function waitForSelector(
  session: Session,
  selector: string,
  options: WaitForOptions = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? 100;
  const timeoutMs = options.timeoutMs ?? 10000;
  const deadline = Date.now() + timeoutMs;
  const conn = await page(session);
  for (;;) {
    const found = await evalString(
      conn,
      `document.querySelector(${quoteJs(selector)}) ? '1' : '0'`,
    );
    if (found === '1') return;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForSelector timed out after ${timeoutMs}ms: ${selector}`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Return the current page's visible text content (trimmed). */
export async function pageText(session: Session): Promise<string> {
  const conn = await page(session);
  const raw = await evalString(conn, `document.body ? document.body.innerText : ''`);
  return raw.trim();
}

/** Return the current document title. */
export async function pageTitle(session: Session): Promise<string> {
  const conn = await page(session);
  return evalString(conn, `document.title ?? ''`);
}

/** Return the current location.href. */
export async function currentUrl(session: Session): Promise<string> {
  const conn = await page(session);
  return evalString(conn, `location.href`);
}

// --- capture / navigation ---------------------------------------------------

/**
 * Capture a full-page screenshot (scroll height, not just the viewport).
 * Returns the base64-encoded PNG.
 */
export async function fullPageScreenshot(
  session: Session,
  options?: { format?: 'png' | 'jpeg'; quality?: number },
): Promise<string> {
  const conn = await page(session);
  const metrics = await conn.send<Page.GetLayoutMetricsResult>('Page.getLayoutMetrics');
  const width = Math.ceil(metrics.contentSize.width);
  const height = Math.ceil(metrics.contentSize.height);
  const result = await conn.send<Page.CaptureScreenshotResult>('Page.captureScreenshot', {
    format: options?.format ?? 'png',
    quality: options?.quality,
    clip: { x: 0, y: 0, width, height, scale: 1 },
    captureBeyondViewport: true,
  });
  return result.data;
}

/** Capture the viewport-only screenshot. Returns base64 PNG. */
export async function screenshot(
  session: Session,
  options?: { format?: 'png' | 'jpeg'; quality?: number },
): Promise<string> {
  const conn = await page(session);
  const result = await conn.send<Page.CaptureScreenshotResult>('Page.captureScreenshot', {
    format: options?.format ?? 'png',
    quality: options?.quality,
  });
  return result.data;
}

/** Navigate the session's target to a URL. Uses the cached page connection. */
export async function navigatePage(session: Session, url: string): Promise<void> {
  const conn = await page(session);
  await conn.send('Page.navigate', { url });
}

// --- tab management (session-level, uses browser connection) ----------------

export type TabInfo = { id: string; url: string; title?: string; type: string };

/** List all open tabs in the browser backing the session. */
export async function listTabs(session: Session): Promise<TabInfo[]> {
  const targets = await listTargets(session.browserUrl);
  return targets
    .filter((t) => t.type === 'page')
    .map((t) => ({ id: t.id, url: t.url, title: t.title, type: t.type }));
}

/** Create a new tab and return its target id. */
export async function newTab(
  session: Session,
  url?: string,
): Promise<string> {
  return session.newTab(url);
}

/** Close a tab by target id. */
export async function closeTab(
  session: Session,
  targetId: string,
): Promise<void> {
  await session.closeTab(targetId);
}

// Re-exported for adapters that prefer a connection-only shape.
export { createConnection, listTargets };
export type { Target, TargetListEntry, Runtime, Page };
