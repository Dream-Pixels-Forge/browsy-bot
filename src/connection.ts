import WebSocket from 'ws';
import * as http from 'http';
import * as https from 'https';
import { CDPMessage, ConnectionStatus } from './types.js';

type TargetInfo = { id: string; type: string; url: string; title?: string };

/**
 * Discover an available page target id via CDP's HTTP `/json/list` endpoint.
 * Returns the id of the first `type: "page"` target, or undefined if none.
 */
async function discoverPageTarget(browserUrl: string): Promise<string | undefined> {
  let httpUrl = browserUrl.trim().replace(/\/$/, '');
  if (httpUrl.startsWith('ws://')) httpUrl = httpUrl.replace(/^ws/, 'http');
  else if (httpUrl.startsWith('wss://')) httpUrl = httpUrl.replace(/^wss/, 'https');
  else if (!/^https?:\/\//.test(httpUrl)) httpUrl = `http://${httpUrl}`;
  httpUrl = httpUrl.replace(/\/devtools\/.*/, '');

  const endpoint = `${httpUrl}/json/list`;
  return new Promise((resolve) => {
    const req = (endpoint.startsWith('https') ? https : http).get(endpoint, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const targets = JSON.parse(body) as TargetInfo[];
          const page = targets.find((t) => t.type === 'page');
          resolve(page?.id);
        } catch {
          resolve(undefined);
        }
      });
      res.on('error', () => resolve(undefined));
    });
    req.on('error', () => resolve(undefined));
  });
}

export class CDPConnection {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private messageId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (result: any) => void; reject: (err: any) => void }
  >();
  private eventListeners = new Map<string, ((data: any) => void)[]>();
  private readonly url: string;
  private readonly targetId?: string;

  constructor(url: string, targetId?: string) {
    this.url = url;
    this.targetId = targetId;
  }

  async connect(): Promise<void> {
    if (this.status === ConnectionStatus.CONNECTED) {
      throw new Error('Already connected');
    }

    this.status = ConnectionStatus.CONNECTING;

    return new Promise((resolve, reject) => {
      let settled = false;
      const onOpen = () => {
        if (settled) return;
        settled = true;
        this.status = ConnectionStatus.CONNECTED;
        resolve();
      };
      const onError = (error: Error) => {
        if (settled) return;
        settled = true;
        this.status = ConnectionStatus.DISCONNECTED;
        reject(error);
      };

      try {
        this.ws = new WebSocket(this.url);

        this.ws.on('open', onOpen);

        this.ws.on('message', (data: WebSocket.RawData) => {
          const message = JSON.parse(data.toString()) as CDPMessage;
          this.handleMessage(message);
        });

        this.ws.on('close', () => {
          this.status = ConnectionStatus.CLOSED;
          this.rejectAllPending(new Error('CDP connection closed'));
        });

        this.ws.on('error', (error: Error) => {
          if (this.status === ConnectionStatus.CONNECTING) {
            onError(error);
          } else {
            this.status = ConnectionStatus.DISCONNECTED;
            this.rejectAllPending(error);
          }
        });
      } catch (error) {
        onError(error as Error);
      }
    });
  }

  async close(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.status = ConnectionStatus.DISCONNECTED;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.status === ConnectionStatus.CONNECTED && this.ws !== null;
  }

  async send<T = any>(method: string, params?: any): Promise<T> {
    if (!this.ws || this.status !== ConnectionStatus.CONNECTED) {
      throw new Error('Not connected to CDP');
    }

    const id = ++this.messageId;
    const message: CDPMessage = { id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`CDP request timeout: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (result: T) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (err: any) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.ws!.send(JSON.stringify(message));
    });
  }

  on(event: string, callback: (data: any) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private handleMessage(message: CDPMessage): void {
    // Handle response to our request
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(
            Object.assign(new Error(message.error.message), {
              code: message.error.code,
              data: message.error.data,
            }),
          );
        } else {
          pending.resolve(message.result as any);
        }
      }
    }
    // Handle events
    else if (message.method) {
      const listeners = this.eventListeners.get(message.method);
      if (listeners) {
        listeners.forEach((listener) => listener(message));
      }
    }
  }

  getUrl(): string {
    return this.url;
  }

  getTargetId(): string | undefined {
    return this.targetId;
  }
}

// One-shot convenience helpers. Each opens a temporary CDP connection,
// runs a single command, and closes it.

export async function navigate(
  browserUrl: string,
  url: string,
  targetId?: string,
): Promise<void> {
  const conn = await createConnection(browserUrl, targetId);
  try {
    await conn.send('Page.navigate', { url });
  } finally {
    await conn.close();
  }
}

export async function captureScreenshot(
  browserUrl: string,
  options?: { format?: 'png' | 'jpeg'; quality?: number; clip?: any; fromSurface?: boolean },
  targetId?: string,
): Promise<string> {
  const conn = await createConnection(browserUrl, targetId);
  try {
    const result = await conn.send<{ data: string }>('Page.captureScreenshot', options || {});
    return result.data;
  } finally {
    await conn.close();
  }
}

export async function evaluate(
  browserUrl: string,
  expression: string,
  targetId?: string,
): Promise<any> {
  const conn = await createConnection(browserUrl, targetId);
  try {
    return await conn.send('Runtime.evaluate', { expression, returnByValue: true });
  } finally {
    await conn.close();
  }
}

// Resolve the WebSocket debugger URL for a given targetId.
// Accepts ws://, wss://, http://, https://, or a bare host:port.
function resolveWsUrl(browserUrl: string, targetId?: string): string {
  let url = browserUrl.trim().replace(/\/$/, '');

  // Convert http(s):// -> ws(s)://
  if (url.startsWith('http://')) url = url.replace(/^http/, 'ws');
  else if (url.startsWith('https://')) url = url.replace(/^https/, 'wss');

  // Bare host:port -> ws://host:port
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    url = `ws://${url}`;
  }

  // If a targetId is given, talk to that page target directly.
  // The browser-level endpoint (/devtools/browser) does NOT support Page domain.
  if (targetId) {
    const base = url.replace(/\/devtools\/(browser|page).*/, '');
    return `${base}/devtools/page/${targetId}`;
  }

  // Default to the browser-level endpoint when no targetId is given.
  if (!/\/devtools\//.test(url)) {
    return `${url}/devtools/browser`;
  }

  return url;
}

// Helper to create connection from browser URL. When no targetId is given,
// auto-discovers the first page target via the HTTP /json/list endpoint so
// Page-domain commands actually work.
export async function createConnection(
  browserUrl: string,
  targetId?: string,
): Promise<CDPConnection> {
  let resolvedTargetId = targetId;
  if (!resolvedTargetId) {
    resolvedTargetId = await discoverPageTarget(browserUrl);
  }
  const fullUrl = resolveWsUrl(browserUrl, resolvedTargetId);
  const connection = new CDPConnection(fullUrl, resolvedTargetId);
  await connection.connect();
  return connection;
}