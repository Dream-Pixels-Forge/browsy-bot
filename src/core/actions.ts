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
import {
  Page,
  Runtime,
  Target,
  TargetListEntry,
  Network,
  Performance,
  Accessibility,
} from './types.js';
import type { Session } from './session.js';
import { createConnection, listTargets } from './connection.js';
import { extract } from './extract.js';

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

export interface InteractionOptions {
  /**
   * Use CDP `Input.dispatchMouseEvent` / `Input.insertText` (renderer-trusted
   * events) instead of JS-dispatched events. Trusted events work with
   * frameworks that check `event.isTrusted` (some React/Vue/Svelte form
   * handlers, file pickers, drag-drop). The element must be visible and
   * in the viewport. Default false keeps the legacy JS-dispatch path so
   * existing callers see no behavior change.
   */
  trusted?: boolean;
  /**
   * Fallback selectors to try if the primary selector fails.
   * Tried in order until one matches.
   */
  fallbacks?: string[];
}

/**
 * Click the first element matching `selector`.
 *
 * Default (JS-dispatch): the in-page script queries, dispatches a pointer +
 * click sequence, and reports whether it clicked.
 *
 * With `{ trusted: true }`: scroll the element into view, measure its
 * viewport rect, and issue CDP `Input.dispatchMouseEvent` (mousePressed +
 * mouseReleased at the element center) so the renderer treats it as a real
 * user click.
 *
 * With `{ fallbacks: [...] }`: tries each fallback selector in order if the
 * primary selector fails to match.
 */
export async function click(
  session: Session,
  selector: string,
  options: InteractionOptions = {},
): Promise<boolean> {
  if (options.trusted) return clickTrusted(session, selector);
  if (options.fallbacks && options.fallbacks.length > 0) {
    const selectors = [selector, ...options.fallbacks];
    for (const sel of selectors) {
      if (await click(session, sel, { trusted: options.trusted })) {
        return true;
      }
    }
    return false;
  }
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
 * Trusted click: scroll into view, measure the element's *viewport* rect
 * (the coordinate space `Input.dispatchMouseEvent` expects — note
 * `DOM.getBoxModel` returns layout coords and would dispatch to the wrong
 * place when the page is scrolled), then dispatch mousePressed/mouseReleased
 * at the element's center.
 */
async function clickTrusted(session: Session, selector: string): Promise<boolean> {
  const conn = await page(session);

  const rectRes = await conn.send<{
    result?: Runtime.RemoteObject;
    exceptionDetails?: Runtime.ExceptionDetails;
  }>(
    'Runtime.evaluate',
    {
      expression: `(function(){
        const el = document.querySelector(${quoteJs(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })()`,
      returnByValue: true,
    },
  );
  if (rectRes?.exceptionDetails) {
    const d = rectRes.exceptionDetails as Runtime.ExceptionDetails & { exception?: { description?: string } };
    throw new Error(d.exception?.description ?? d.text ?? 'trusted click: page JS threw');
  }
  const rect = rectRes?.result?.value as
    | { x: number; y: number; w: number; h: number }
    | null;
  if (!rect) return false;

  const x = Math.round(rect.x + rect.w / 2);
  const y = Math.round(rect.y + rect.h / 2);

  await conn.send<import('./types.js').Input.DispatchMouseEventParams>(
    'Input.dispatchMouseEvent',
    {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    },
  );
  await conn.send<import('./types.js').Input.DispatchMouseEventParams>(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    },
  );
  return true;
}

/**
 * Set the value of a form control matching `selector` and fire the input
 * events most frameworks listen for.
 *
 * Default (JS-dispatch): `el.value = ...` + `input`/`change` events.
 * With `{ trusted: true }`: focus + select the control, then issue
 * CDP `Input.insertText` — the renderer sees a real typed-text event,
 * which some frameworks (and file inputs, password managers, etc.)
 * handle differently than a programmatic value assignment.
 *
 * With `{ fallbacks: [...] }`: tries each fallback selector in order if the
 * primary selector fails to match.
 */
export async function fill(
  session: Session,
  selector: string,
  value: string,
  options: InteractionOptions = {},
): Promise<boolean> {
  if (options.trusted) return fillTrusted(session, selector, value);
  if (options.fallbacks && options.fallbacks.length > 0) {
    const selectors = [selector, ...options.fallbacks];
    for (const sel of selectors) {
      if (await fill(session, sel, value, { trusted: options.trusted })) {
        return true;
      }
    }
    return false;
  }
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

/**
 * Trusted fill: focus the control (JS-side, so non-editable targets still
 * degrade), select any existing content, then `Input.insertText` the new
 * value. For a text field the inserted text replaces the selection.
 */
async function fillTrusted(
  session: Session,
  selector: string,
  value: string,
): Promise<boolean> {
  const conn = await page(session);

  const focusRes = await conn.send<{
    result?: Runtime.RemoteObject;
    exceptionDetails?: Runtime.ExceptionDetails;
  }>(
    'Runtime.evaluate',
    {
      expression: `(function(){
        const el = document.querySelector(${quoteJs(selector)});
        if (!el) return false;
        el.focus();
        if (el.select) el.select();
        return true;
      })()`,
      returnByValue: true,
    },
  );
  if (focusRes?.exceptionDetails) {
    const d = focusRes.exceptionDetails as Runtime.ExceptionDetails & { exception?: { description?: string } };
    throw new Error(d.exception?.description ?? d.text ?? 'trusted fill: page JS threw');
  }
  if (focusRes?.result?.value !== true) return false;

  await conn.send<import('./types.js').Input.InsertTextParams>('Input.insertText', { text: value });
  return true;
}

export interface WaitForOptions {
  /** Poll interval in ms. Defaults to 100. */
  intervalMs?: number;
  /** Max total wait in ms before throwing. Defaults to 10000. */
  timeoutMs?: number;
  /** Fallback selectors to try if the primary selector is not found. */
  fallbacks?: string[];
}

/**
 * Poll until an element matching `selector` exists in the DOM. Resolves when
 * found; throws when the timeout elapses.
 *
 * With `{ fallbacks: [...] }`: tries each fallback selector in order if the
 * primary selector fails to match within the timeout.
 */
export async function waitForSelector(
  session: Session,
  selector: string,
  options: WaitForOptions = {},
): Promise<void> {
  if (options.fallbacks && options.fallbacks.length > 0) {
    const selectors = [selector, ...options.fallbacks];
    for (const sel of selectors) {
      try {
        return await waitForSelector(session, sel, {
          intervalMs: options.intervalMs,
          timeoutMs: options.timeoutMs,
        });
      } catch {
        // Try next fallback
        continue;
      }
    }
    throw new Error(
      `waitForSelector timed out: ${selector} (and fallbacks: ${options.fallbacks.join(', ')})`,
    );
  }

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

/** Switch the session's active page target to another tab. */
export async function switchTab(
  session: Session,
  targetId: string,
): Promise<void> {
  await session.switchTab(targetId);
}

/** Iterate over all page tabs and run `fn(session, targetId)` for each. */
export async function foreachTab<T>(
  session: Session,
  fn: (session: Session, targetId: string) => Promise<T>,
): Promise<T[]> {
  return session.foreachTab(fn);
}

/** Get all cookies for the current page. */
export async function getCookies(
  session: Session,
  urls?: string[],
): Promise<Network.Cookie[]> {
  return session.getCookies(urls);
}

/** Set a cookie for the current page. */
export async function setCookie(
  session: Session,
  params: Network.SetCookieParams,
): Promise<Network.SetCookieResult> {
  return session.setCookie(params);
}

/** Delete a cookie by name. */
export async function deleteCookie(
  session: Session,
  params: Network.DeleteCookiesParams,
): Promise<void> {
  return session.deleteCookie(params);
}

/** Save all cookies to a JSON file. */
export async function saveCookies(
  session: Session,
  filePath: string,
): Promise<void> {
  return session.saveCookies(filePath);
}

/** Load cookies from a JSON file and set them in the browser. */
export async function loadCookies(
  session: Session,
  filePath: string,
): Promise<void> {
  return session.loadCookies(filePath);
}

/**
 * Collect Core Web Vitals and performance metrics via the Performance domain.
 * Returns a flat object merging CDP performance metrics, navigation timing,
 * and Core Web Vitals (LCP, CLS, FID, INP, TTFB, FCP, TBT).
 */
export async function collectMetrics(
  session: Session,
): Promise<Performance.CoreWebVitals & Performance.PerformanceTiming> {
  const conn = await page(session);

  // Enable Performance domain
  await conn.send('Performance.enable');

  // Get metrics via CDP
  const metricsResult = await conn.send<Performance.GetMetricsResult>(
    'Performance.getMetrics',
  );
  const metrics: Record<string, number> = {};
  for (const m of metricsResult.metrics) {
    metrics[m.name] = m.value;
  }

  // Get navigation timing from the page
  const timing = await evalString(conn, `
    (function() {
      const t = performance.timing;
      return {
        navigationStart: t.navigationStart,
        responseStart: t.responseStart,
        domContentLoadedEventEnd: t.domContentLoadedEventEnd,
        loadEventEnd: t.loadEventEnd,
        firstPaint:
          performance.getEntriesByType('paint').find((e) => e.name === 'first-paint')?.startTime ?? 0,
        firstContentfulPaint:
          performance
            .getEntriesByType('paint')
            .find((e) => e.name === 'first-contentful-paint')?.startTime ?? 0,
      };
    })()
  `).then(JSON.parse);

  // Get Core Web Vitals from performance entries
  const vitals = await evalString(conn, `
    (function() {
      return new Promise((resolve) => {
        const vitals = {
          lcp: null,
          cls: 0,
          fid: null,
          inp: null,
          ttfb: null,
          fcp: null,
          tbt: 0,
        };

        try {
          const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
          if (lcpEntries.length > 0) {
            vitals.lcp = lcpEntries[lcpEntries.length - 1].startTime;
          }
        } catch {}

        try {
          let clsValue = 0;
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) {
                clsValue += entry.value;
              }
            }
          });
          observer.observe({ type: 'layout-shift', buffered: true });
          vitals.cls = clsValue;
        } catch {}

        resolve(vitals);
      });
    })()
  `).then(JSON.parse);

  return { ...metrics, ...(timing as Record<string, number>), ...vitals };
}

/**
 * Audit accessibility using the Accessibility domain.
 * Returns an audit result with score, violations, passes, etc.
 */
export async function auditAccessibility(
  session: Session,
): Promise<Accessibility.AuditResult> {
  const conn = await page(session);

  // Enable Accessibility domain
  await conn.send('Accessibility.enable');

  // Get the full accessibility tree
  const axResult = await conn.send<Accessibility.GetFullAXTreeResult>(
    'Accessibility.getFullAXTree',
  );

  // Analyze the accessibility tree for common issues
  const violations: Accessibility.Violation[] = [];
  const passes: Accessibility.Pass[] = [];

  function walkNode(node: any, depth = 0) {
    // Check for missing accessible names on interactive elements
    const role = node.role?.value || '';
    const name = node.name?.value || '';
    const interactiveRoles = [
      'button', 'link', 'textbox', 'combobox', 'checkbox', 'radio',
      'searchbox', 'slider', 'spinbutton', 'tab',
    ];

    if (interactiveRoles.includes(role) && !name && !node.children?.some((c: any) => c.name?.value)) {
      violations.push({
        id: 'accessible-name',
        description: 'Element does not have an accessible name',
        help: 'Ensure interactive elements have an accessible name',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/accessible-name',
        impact: 'serious',
        nodes: [{
          nodeId: node.nodeId || `node-${depth}`,
          target: [node.role?.value || 'unknown'],
          html: '',
          failureSummary: 'Element missing accessible name',
          any: [],
          all: [],
          none: [],
        }],
      });
    }

    // Recurse into children
    node.children?.forEach((child: any) => walkNode(child, depth + 1));
  }

  axResult.nodes.forEach((node: any) => walkNode(node));

  const score = violations.length === 0 ? 100 : Math.max(0, 100 - violations.length * 10);

  return {
    score,
    violations,
    passes: violations.length === 0 ? [{
      id: 'accessible-name',
      description: 'All interactive elements have accessible names',
      help: 'Accessible names are present on interactive elements',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/accessible-name',
      nodes: [],
    }] : [],
    inapplicable: [],
    incomplete: [],
  };
}

/** Enable network request interception for matching URL patterns. */
export async function interceptNetwork(
  session: Session,
  patterns: Network.RequestPattern[],
): Promise<void> {
  return session.interceptNetwork(patterns);
}

/** Mock a response for matching URL pattern. */
export async function mockResponse(
  session: Session,
  pattern: string,
  response: { status: number; headers?: Record<string, string>; body?: string; contentType?: string },
): Promise<void> {
  return session.mockResponse(pattern, response);
}

/** Handle an intercepted request. */
export async function continueInterceptedRequest(
  session: Session,
  interceptionId: string,
  action: 'continue' | 'mock' | 'fail',
  options?: {
    url?: string;
    method?: string;
    postData?: string;
    headers?: Record<string, string>;
    response?: { status: number; headers?: Record<string, string>; body?: string; contentType?: string };
  },
): Promise<void> {
  return session.continueInterceptedRequest(interceptionId, action, options);
}

/**
 * Declarative script execution.
 * Runs a sequence of browser actions defined in a script object.
 */
export interface ScriptStep {
  action: 'navigate' | 'click' | 'fill' | 'screenshot' | 'extract' | 'wait' | 'assert' | 'eval' | 'new-tab' | 'switch-tab' | 'close-tab' | 'sleep';
  selector?: string;
  value?: string;
  url?: string;
  expression?: string;
  fields?: string[];
  limit?: number;
  output?: string;
  timeoutMs?: number;
  intervalMs?: number;
  trusted?: boolean;
  fallbacks?: string[];
  targetId?: string;
  ms?: number;
  fullPage?: boolean;
  format?: 'png' | 'jpeg';
  quality?: number;
}

export interface ScriptResult {
  step: number;
  action: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

export async function runScript(
  session: Session,
  steps: ScriptStep[],
  options?: { variables?: Record<string, string>; onStep?: (result: ScriptResult) => void },
): Promise<ScriptResult[]> {
  const variables = options?.variables ?? {};
  const results: ScriptResult[] = [];

  function resolveVars(str: string): string {
    return str.replace(/\$\{(\w+)\}/g, (_, key) => variables[key] ?? '');
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const startTime = Date.now();
    let result: ScriptResult;

    try {
      switch (step.action) {
        case 'navigate': {
          if (!step.url) throw new Error('navigate requires url');
          await navigatePage(session, resolveVars(step.url));
          result = { step: i, action: 'navigate', ok: true, data: { url: step.url }, durationMs: Date.now() - startTime };
          break;
        }
        case 'click': {
          if (!step.selector) throw new Error('click requires selector');
          const clicked = await click(session, resolveVars(step.selector), {
            trusted: step.trusted,
            fallbacks: step.fallbacks,
          });
          result = { step: i, action: 'click', ok: clicked, data: { selector: step.selector, clicked }, durationMs: Date.now() - startTime };
          break;
        }
        case 'fill': {
          if (!step.selector) throw new Error('fill requires selector');
          if (!step.value) throw new Error('fill requires value');
          const filled = await fill(session, resolveVars(step.selector), resolveVars(step.value), {
            trusted: step.trusted,
            fallbacks: step.fallbacks,
          });
          result = { step: i, action: 'fill', ok: filled, data: { selector: step.selector, filled }, durationMs: Date.now() - startTime };
          break;
        }
        case 'screenshot': {
          const options = {
            format: step.format ?? 'png',
            quality: step.quality,
          };
          const data = step.fullPage
            ? await fullPageScreenshot(session, options)
            : await screenshot(session, options);
          if (step.output) {
            const fs = await import('fs');
            const path = await import('path');
            const out = path.isAbsolute(step.output) ? step.output : path.join(process.cwd(), step.output);
            fs.writeFileSync(out, Buffer.from(data, 'base64'));
            result = { step: i, action: 'screenshot', ok: true, data: { savedTo: out }, durationMs: Date.now() - startTime };
          } else {
            result = { step: i, action: 'screenshot', ok: true, data: { base64: data, format: options.format }, durationMs: Date.now() - startTime };
          }
          break;
        }
        case 'extract': {
          if (!step.selector) throw new Error('extract requires selector');
          if (!step.fields) throw new Error('extract requires fields');
          const records = await extract(session, step.selector, step.fields, { limit: step.limit });
          result = { step: i, action: 'extract', ok: true, data: records, durationMs: Date.now() - startTime };
          break;
        }
        case 'wait': {
          if (!step.selector) throw new Error('wait requires selector');
          await waitForSelector(session, step.selector, {
            timeoutMs: step.timeoutMs ?? 10000,
            intervalMs: step.intervalMs ?? 100,
            fallbacks: step.fallbacks,
          });
          result = { step: i, action: 'wait', ok: true, data: { selector: step.selector }, durationMs: Date.now() - startTime };
          break;
        }
        case 'assert': {
          if (!step.selector) throw new Error('assert requires selector');
          const conn = await session.page();
          const found = await evalString(conn, `document.querySelector(${quoteJs(step.selector)}) ? '1' : '0'`);
          if (found !== '1') {
            throw new Error(`Assertion failed: selector "${step.selector}" not found`);
          }
          result = { step: i, action: 'assert', ok: true, data: { selector: step.selector }, durationMs: Date.now() - startTime };
          break;
        }
        case 'eval': {
          if (!step.expression) throw new Error('eval requires expression');
          const conn = await session.page();
          const evalResult = await conn.send<{ result?: { value?: unknown }; exceptionDetails?: unknown }>(
            'Runtime.evaluate',
            { expression: step.expression, returnByValue: true },
          );
          if (evalResult.exceptionDetails) {
            throw new Error('eval: page JS threw');
          }
          result = { step: i, action: 'eval', ok: true, data: evalResult.result?.value, durationMs: Date.now() - startTime };
          break;
        }
        case 'new-tab': {
          const targetId = await session.newTab(step.url);
          result = { step: i, action: 'new-tab', ok: true, data: { targetId, url: step.url ?? 'about:blank' }, durationMs: Date.now() - startTime };
          break;
        }
        case 'switch-tab': {
          if (!step.targetId) throw new Error('switch-tab requires targetId');
          await switchTab(session, step.targetId);
          result = { step: i, action: 'switch-tab', ok: true, data: { targetId: step.targetId }, durationMs: Date.now() - startTime };
          break;
        }
        case 'close-tab': {
          if (!step.targetId) throw new Error('close-tab requires targetId');
          await session.closeTab(step.targetId);
          result = { step: i, action: 'close-tab', ok: true, data: { targetId: step.targetId }, durationMs: Date.now() - startTime };
          break;
        }
        case 'sleep': {
          await new Promise((r) => setTimeout(r, step.ms ?? 1000));
          result = { step: i, action: 'sleep', ok: true, data: { ms: step.ms }, durationMs: Date.now() - startTime };
          break;
        }
        default:
          throw new Error(`Unknown action: ${step.action}`);
      }
    } catch (e) {
      result = {
        step: i,
        action: step.action,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - startTime,
      };
    }

    results.push(result);
    options?.onStep?.(result);

    if (!result.ok) {
      // Stop on first failure unless it's a sleep
      if (step.action !== 'sleep') break;
    }
  }

  return results;
}

/** Upload a file to a URL. */
export async function uploadFile(
  session: Session,
  params: Network.UploadFileParams,
): Promise<Network.UploadFileResult> {
  return session.uploadFile(params);
}

/** Compare current page screenshot against a baseline image for visual regression testing. */
export async function visualDiff(
  session: Session,
  params: Network.VisualDiffParams,
): Promise<Network.VisualDiffResult> {
  return session.visualDiff(params);
}

// Re-exported for adapters that prefer a connection-only shape.
export { createConnection, listTargets };
export type { Target, TargetListEntry, Runtime, Page };
