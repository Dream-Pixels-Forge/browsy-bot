// Session — a cached, long-lived CDP connection per (browserUrl, targetId).
//
// Why: every convenience helper in connection.ts opens a fresh WebSocket,
// runs one command, and closes it. A 5-step flow costs 5 handshakes and
// loses all event state (console messages, network logs, load events)
// between calls. A Session keeps one socket open and captures CDP events
// for the lifetime of the task, so repeated calls are cheap and
// captureConsole()/captureNetwork() have data to return.
//
// Usage:
//   const s = await getSession("ws://localhost:9222");
//   await click(s, ".save");
//   await fill(s, "#email", "a@b.c");
//   const logs = await captureConsole(s);
//   await s.closeAll();
//
// Sessions are cached in a module-level map keyed by
// (browserUrl, targetId ?? "<auto>") so MCP/CLI calls in the same
// process reuse the same socket.

import {
  CDPConnection,
  createConnection,
  discoverPageTarget,
  listTargets,
  resolveWsUrl,
} from './connection.js';
import { ConsoleEntry, NetworkEntry, Network, Target, TargetListEntry } from './types.js';

type PageConnection = CDPConnection & { targetId?: string };

export interface Session {
  /** Browser-level CDP connection (no target) — for Target.* commands. */
  browser(): Promise<CDPConnection>;
  /** Page-level CDP connection for the session's target. */
  page(): Promise<CDPConnection>;
  /** The page target id this session operates on (resolved on creation). */
  readonly targetId: string | undefined;
  /** The raw browser endpoint URL this session is bound to. */
  readonly browserUrl: string;
  /** All CDP targets (tabs) currently open in the browser. */
  listTabs(): Promise<TargetListEntry[]>;
  /** Create a new tab; returns its target id. */
  newTab(url?: string): Promise<string>;
  /** Close a tab by target id. */
  closeTab(targetId: string): Promise<void>;
  /**
   * Switch the session's active page target to another tab.
   * Subsequent calls to page() will connect to the new target.
   */
  switchTab(targetId: string): Promise<void>;
  /**
   * Iterate over all page tabs and run `fn(session, targetId)` for each.
   * Each iteration gets a fresh page connection to that tab.
   */
  foreachTab<T>(fn: (session: Session, targetId: string) => Promise<T>): Promise<T[]>;
  /**
   * Get all cookies for the current page (or optionally filter by URLs).
   * Uses CDP Network.getCookies.
   */
  getCookies(urls?: string[]): Promise<Network.Cookie[]>;
  /**
   * Set a cookie for the current page.
   * Uses CDP Network.setCookie.
   */
  setCookie(params: Network.SetCookieParams): Promise<Network.SetCookieResult>;
  /**
   * Delete a cookie by name.
   * Uses CDP Network.deleteCookies.
   */
  deleteCookie(params: Network.DeleteCookiesParams): Promise<void>;
  /**
   * Save all cookies to a JSON file.
   */
  saveCookies(filePath: string): Promise<void>;
  /**
   * Load cookies from a JSON file and set them in the browser.
   */
  loadCookies(filePath: string): Promise<void>;
  /**
   * Enable network request interception for matching URL patterns.
   * Uses CDP Fetch domain for interception.
   */
  interceptNetwork(patterns: Network.RequestPattern[]): Promise<void>;
  /**
   * Mock a response for matching URL pattern.
   * Uses CDP Network.setResponseOverride for simpler mocking.
   */
  mockResponse(pattern: string, response: { status: number; headers?: Record<string, string>; body?: string; contentType?: string }): Promise<void>;
  /**
   * Handle an intercepted request - continue, mock, or fail.
   */
  continueInterceptedRequest(interceptionId: string, action: 'continue' | 'mock' | 'fail', options?: { url?: string; method?: string; postData?: string; headers?: Record<string, string>; response?: { status: number; headers?: Record<string, string>; body?: string; contentType?: string } }): Promise<void>;
  /**
   * Console messages captured since the session started capturing.
   * Starts capturing immediately (enable is idempotent, once per socket).
   */
  captureConsole(): ConsoleEntry[];
  /**
   * Network entries. Requests complete with a response; live in-progress
   * requests appear with status 0 until they finish.
   */
  captureNetwork(): NetworkEntry[];
  /** Close every cached connection for this session and drop the cache. */
  closeAll(): Promise<void>;
}

// --- module-level connection cache ----------------------------------------

type CacheEntry = { conn: CDPConnection };
const connCache = new Map<string, CacheEntry>();

function cacheKey(browserUrl: string, targetId?: string, level?: 'page' | 'browser'): string {
  return `${browserUrl}\u0000${targetId ?? ''}\u0000${level ?? 'page'}`;
}

async function getPageConnection(browserUrl: string, targetId?: string): Promise<CDPConnection> {
  const key = cacheKey(browserUrl, targetId, 'page');
  const hit = connCache.get(key);
  if (hit && hit.conn.isConnected()) return hit.conn;
  if (hit) {
    connCache.delete(key);
    await hit.conn.close().catch(() => {});
  }
  const conn = await createConnection(browserUrl, targetId);
  connCache.set(key, { conn });
  return conn;
}

async function getBrowserConnection(browserUrl: string): Promise<CDPConnection> {
  const key = cacheKey(browserUrl, undefined, 'browser');
  const hit = connCache.get(key);
  if (hit && hit.conn.isConnected()) return hit.conn;
  if (hit) {
    connCache.delete(key);
    await hit.conn.close().catch(() => {});
  }
  const url = resolveWsUrl(browserUrl);
  const conn = new CDPConnection(url);
  await conn.connect();
  connCache.set(key, { conn });
  return conn;
}

// --- console / network event capture --------------------------------------

function toText(args: Array<{ value?: any; description?: string; unserializableValue?: number; typedValue?: string }>): string {
  return args
    .map((a) => {
      if (a.typedValue !== undefined) return a.typedValue;
      if (a.value !== undefined) return String(a.value);
      return a.description ?? '';
    })
    .join(' ');
}

interface ConsoleTracker {
  enabled: boolean;
  entries: ConsoleEntry[];
}
interface NetworkTracker {
  enabled: boolean;
  entries: Map<string, NetworkEntry>;
}
const consoleTrackers = new Map<string, ConsoleTracker>();
const networkTrackers = new Map<string, NetworkTracker>();

function trackerKey(browserUrl: string, targetId: string | undefined, kind: 'console' | 'network'): string {
  return `${browserUrl}\u0000${targetId ?? ''}\u0000${kind}`;
}

function ensureConsoleCapturing(browserUrl: string, conn: CDPConnection): ConsoleTracker {
  const key = trackerKey(browserUrl, conn.getTargetId(), 'console');
  let tracker = consoleTrackers.get(key);
  if (!tracker) {
    tracker = { enabled: false, entries: [] };
    consoleTrackers.set(key, tracker);
  }
  if (!tracker.enabled) {
    tracker.enabled = true;
    conn.on('Runtime.consoleAPICalled', (msg: any) => {
      const type = String(msg.params?.type ?? 'log');
      const args = (msg.params?.args ?? []) as any[];
      tracker!.entries.push({
        type,
        text: toText(args),
        timestamp: msg.params?.timestamp,
      });
    });
    conn.on('Runtime.exceptionThrown', (msg: any) => {
      const d = msg.params?.exceptionDetails;
      const text = d?.exception?.description ?? d?.text ?? 'uncaught exception';
      tracker!.entries.push({ type: 'exception', text: String(text) });
    });
  }
  return tracker;
}

function ensureNetworkCapturing(browserUrl: string, conn: CDPConnection): NetworkTracker {
  const key = trackerKey(browserUrl, conn.getTargetId(), 'network');
  let tracker = networkTrackers.get(key);
  if (!tracker) {
    tracker = { enabled: false, entries: new Map() };
    networkTrackers.set(key, tracker);
  }
  if (!tracker.enabled) {
    tracker.enabled = true;
    conn.on('Network.requestWillBeSent', (msg: any) => {
      const p = msg.params;
      tracker!.entries.set(p.requestId, {
        requestId: p.requestId,
        method: p.method,
        url: p.url,
        resourceType: p.resourceType,
      });
    });
    conn.on('Network.responseReceived', (msg: any) => {
      const p = msg.params;
      const entry = tracker!.entries.get(p.requestId);
      if (entry) {
        entry.status = p.response.status;
        entry.statusText = p.response.statusText;
        if (!entry.resourceType) entry.resourceType = p.type;
      } else {
        tracker!.entries.set(p.requestId, {
          requestId: p.requestId,
          method: 'GET',
          url: p.response.url,
          status: p.response.status,
          statusText: p.response.statusText,
          resourceType: p.type,
        });
      }
    });
    conn.on('Network.loadingFailed', (msg: any) => {
      const p = msg.params;
      const entry = tracker!.entries.get(p.requestId);
      if (entry && entry.status === undefined) {
        entry.status = 0; // 0 = failed before a response (per CDP semantics we store 0)
        entry.statusText = p.errorText;
      }
    });
  }
  return tracker;
}

// --- session implementation ----------------------------------------------

class SessionImpl implements Session {
  constructor(
    public readonly browserUrl: string,
    public readonly targetId: string | undefined,
  ) {}

  private cachedPage: CDPConnection | null = null;
  private cachedBrowser: CDPConnection | null = null;

  async page(): Promise<CDPConnection> {
    if (this.cachedPage?.isConnected()) return this.cachedPage;
    if (this.cachedPage) {
      this.cachedPage = null;
    }
    this.cachedPage = await getPageConnection(this.browserUrl, this.targetId);
    await this.enableDomains();
    return this.cachedPage;
  }

  async browser(): Promise<CDPConnection> {
    if (this.cachedBrowser?.isConnected()) return this.cachedBrowser;
    if (this.cachedBrowser) this.cachedBrowser = null;
    this.cachedBrowser = await getBrowserConnection(this.browserUrl);
    return this.cachedBrowser;
  }

  private async enableDomains(): Promise<void> {
    const page = this.cachedPage!;
    try {
      await page.send('Runtime.enable');
      await page.send('Network.enable');
    } catch {
      // Domains are best-effort at enable time; if CDP rejected them we
      // still serve what we have.
    }
    // Register event listeners (idempotent — the trackers dedupe).
    ensureConsoleCapturing(this.browserUrl, page);
    ensureNetworkCapturing(this.browserUrl, page);
  }

  listTabs(): Promise<TargetListEntry[]> {
    return listTargets(this.browserUrl);
  }

  async newTab(url?: string): Promise<string> {
    const browser = await this.browser();
    const result = await browser.send<Target.CreateTargetResult>('Target.createTarget', {
      url: url ?? 'about:blank',
    });
    return result.targetId;
  }

  async closeTab(targetId: string): Promise<void> {
    const browser = await this.browser();
    await browser.send('Target.closeTarget', { targetId });
  }

  async switchTab(targetId: string): Promise<void> {
    // Close the current page connection if it exists
    if (this.cachedPage) {
      await this.cachedPage.close().catch(() => {});
      this.cachedPage = null;
    }
    // Update the targetId by creating a new SessionImpl with the new targetId
    // We need to drop the old session from cache and create a new one
    // But since targetId is readonly, we'll just update the cached page connection
    // The getSession cache uses (browserUrl, targetId) as key, so we need to
    // remove the old key and add the new one
    const oldKey = `${this.browserUrl}\u0000${this.targetId ?? ''}`;
    sessionCache.delete(oldKey);
    
    // Update the targetId (we'll use a private property to track it)
    // Since targetId is readonly in the interface, we cast away readonly for internal use
    (this as any).targetId = targetId;
    
    // Create new page connection for the new target
    this.cachedPage = await getPageConnection(this.browserUrl, targetId);
    await this.enableDomains();
  }

  async foreachTab<T>(fn: (session: Session, targetId: string) => Promise<T>): Promise<T[]> {
    const targets = await this.listTabs();
    const pageTargets = targets.filter((t) => t.type === 'page');
    const results: T[] = [];
    
    for (const target of pageTargets) {
      // Create a temporary session for this tab
      const tempSession = new SessionImpl(this.browserUrl, target.id);
      try {
        const result = await fn(tempSession, target.id);
        results.push(result);
      } finally {
        await tempSession.closeAll();
      }
    }
    
    return results;
  }

  async getCookies(urls?: string[]): Promise<Network.Cookie[]> {
    const browser = await this.browser();
    const result = await browser.send<Network.GetCookiesResult>('Network.getCookies', { urls });
    return result.cookies ?? [];
  }

  async setCookie(params: Network.SetCookieParams): Promise<Network.SetCookieResult> {
    const browser = await this.browser();
    return browser.send<Network.SetCookieResult>('Network.setCookie', params);
  }

  async deleteCookie(params: Network.DeleteCookiesParams): Promise<void> {
    const browser = await this.browser();
    await browser.send('Network.deleteCookies', params);
  }

  async saveCookies(filePath: string): Promise<void> {
    const cookies = await this.getCookies();
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2));
  }

  async loadCookies(filePath: string): Promise<void> {
    const fs = await import('fs');
    const content = fs.readFileSync(filePath, 'utf-8');
    const cookies: Network.Cookie[] = JSON.parse(content);
    const browser = await this.browser();
    for (const cookie of cookies) {
      await browser.send('Network.setCookie', {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expires: cookie.expires,
      });
    }
  }

  async interceptNetwork(patterns: Network.RequestPattern[]): Promise<void> {
    const page = await this.page();
    // Enable Fetch domain for request interception
    await page.send('Fetch.enable', {
      patterns: patterns.map(p => ({
        urlPattern: p.urlPattern,
        requestStage: p.requestStage,
        resourceType: p.resourceType,
      })),
      handleAuthRequests: false,
    });
  }

  async mockResponse(pattern: string, response: { status: number; headers?: Record<string, string>; body?: string; contentType?: string }): Promise<void> {
    const browser = await this.browser();
    await browser.send('Network.setResponseOverride', {
      urlPattern: pattern,
      response: {
        status: response.status,
        headers: response.headers,
        body: response.body,
        contentType: response.contentType,
      },
    });
  }

  async continueInterceptedRequest(
    interceptionId: string,
    action: 'continue' | 'mock' | 'fail',
    options?: {
      url?: string;
      method?: string;
      postData?: string;
      headers?: Record<string, string>;
      response?: { status: number; headers?: Record<string, string>; body?: string; contentType?: string };
    }
  ): Promise<void> {
    const page = await this.page();
    
    if (action === 'fail') {
      await page.send('Fetch.failRequest', {
        requestId: interceptionId,
        errorReason: 'BlockedByClient',
      });
      return;
    }

    if (action === 'mock' && options?.response) {
      await page.send('Fetch.fulfillRequest', {
        requestId: interceptionId,
        responseCode: options.response.status,
        responseHeaders: options.response.headers
          ? Object.entries(options.response.headers).map(([name, value]) => ({ name, value }))
          : [],
        body: options.response.body,
        responsePhrase: 'OK',
      });
      return;
    }

    // Continue with optional modifications
    await page.send('Fetch.continueRequest', {
      requestId: interceptionId,
      url: options?.url,
      method: options?.method,
      postData: options?.postData,
      headers: options?.headers
        ? Object.entries(options.headers).map(([name, value]) => ({ name, value }))
        : undefined,
    });
  }

  captureConsole(): ConsoleEntry[] {
    const page = this.cachedPage;
    if (page) ensureConsoleCapturing(this.browserUrl, page);
    const tracker = consoleTrackers.get(trackerKey(this.browserUrl, this.targetId, 'console'));
    return tracker ? tracker.entries.slice() : [];
  }

  captureNetwork(): NetworkEntry[] {
    const page = this.cachedPage;
    if (page) ensureNetworkCapturing(this.browserUrl, page);
    const tracker = networkTrackers.get(trackerKey(this.browserUrl, this.targetId, 'network'));
    return tracker ? [...tracker.entries.values()] : [];
  }

  async interceptNetwork(patterns: Network.RequestPattern[]): Promise<void> {
    const page = await this.page();
    // Enable Fetch domain for request interception
    await page.send('Fetch.enable', {
      patterns: patterns.map(p => ({
        urlPattern: p.urlPattern,
        requestStage: p.requestStage,
        resourceType: p.resourceType,
      })),
      handleAuthRequests: false,
    });
  }

  async mockResponse(pattern: string, response: { status: number; headers?: Record<string, string>; body?: string; contentType?: string }): Promise<void> {
    const browser = await this.browser();
    await browser.send('Network.setResponseOverride', {
      urlPattern: pattern,
      response: {
        status: response.status,
        headers: response.headers,
        body: response.body,
        contentType: response.contentType,
      },
    });
  }

  async continueInterceptedRequest(
    interceptionId: string,
    action: 'continue' | 'mock' | 'fail',
    options?: {
      url?: string;
      method?: string;
      postData?: string;
      headers?: Record<string, string>;
      response?: { status: number; headers?: Record<string, string>; body?: string; contentType?: string };
    }
  ): Promise<void> {
    const page = await this.page();
    
    if (action === 'fail') {
      await page.send('Fetch.failRequest', {
        requestId: interceptionId,
        errorReason: 'BlockedByClient',
      });
      return;
    }

    if (action === 'mock' && options?.response) {
      await page.send('Fetch.fulfillRequest', {
        requestId: interceptionId,
        responseCode: options.response.status,
        responseHeaders: options.response.headers
          ? Object.entries(options.response.headers).map(([name, value]) => ({ name, value }))
          : [],
        body: options.response.body,
        responsePhrase: 'OK',
      });
      return;
    }

    // Continue with optional modifications
    await page.send('Fetch.continueRequest', {
      requestId: interceptionId,
      url: options?.url,
      method: options?.method,
      postData: options?.postData,
      headers: options?.headers
        ? Object.entries(options.headers).map(([name, value]) => ({ name, value }))
        : undefined,
    });
  }

  async closeAll(): Promise<void> {
    if (this.cachedPage) {
      await this.cachedPage.close().catch(() => {});
      this.cachedPage = null;
    }
    if (this.cachedBrowser) {
      await this.cachedBrowser.close().catch(() => {});
      this.cachedBrowser = null;
    }
    // Drop the module-level cache entries for this session so the next
    // getSession() starts fresh.
    const keys = [
      trackerKey(this.browserUrl, this.targetId, 'console'),
      trackerKey(this.browserUrl, this.targetId, 'network'),
    ];
    for (const k of keys) {
      consoleTrackers.delete(k);
      networkTrackers.delete(k);
    }
    for (const [k, v] of [...connCache]) {
      if (
        k.startsWith(this.browserUrl + '\u0000') &&
        (k.includes('\u0000page') || k.includes('\u0000browser'))
      ) {
        void v.conn.close().catch(() => {});
        connCache.delete(k);
      }
    }
  }
}

// --- public API -------------------------------------------------------------

export interface SessionOptions {
  /** Operate on an explicit page target instead of auto-discovering. */
  targetId?: string;
}

const sessionCache = new Map<string, SessionImpl>();

/**
 * Get (or create) a cached Session for the given CDP endpoint.
 * Repeated calls with the same (browserUrl, targetId) return the same
 * instance, so console/network capture accumulates across calls.
 */
export async function getSession(browserUrl: string, options?: SessionOptions): Promise<Session> {
  let targetId = options?.targetId;
  if (!targetId) {
    targetId = await discoverPageTarget(browserUrl);
  }
  const key = `${browserUrl}\u0000${targetId ?? ''}`;
  let session = sessionCache.get(key);
  if (!session) {
    session = new SessionImpl(browserUrl, targetId);
    sessionCache.set(key, session);
  }
  return session;
}

/** Drop the cached session for (browserUrl, targetId). */
export function dropSession(browserUrl: string, targetId?: string): void {
  sessionCache.delete(`${browserUrl}\u0000${targetId ?? ''}`);
}

/** Close every session and connection in the process. For test/shutdown. */
export async function closeAllSessions(): Promise<void> {
  for (const session of sessionCache.values()) {
    await session.closeAll();
  }
  sessionCache.clear();
}
