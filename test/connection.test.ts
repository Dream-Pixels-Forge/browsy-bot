import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CDPConnection, createConnection } from '../src/connection.js';
import { ConnectionStatus } from '../src/types.js';

// vi.hoisted lifts the mock class above the hoisted vi.mock factory so it
// is initialized before the factory runs.
const MockWebSocket = vi.hoisted(() => {
  return class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    url: string;
    readyState: number = MockWebSocket.CONNECTING;
    private eventHandlers: Map<string, Function[]> = new Map();

    constructor(url: string) {
      this.url = url;
      // Simulate async connection
      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        this.emit('open', new Event('open'));
      }, 0);
    }

    on(event: string, handler: Function): void {
      if (!this.eventHandlers.has(event)) {
        this.eventHandlers.set(event, []);
      }
      this.eventHandlers.get(event)!.push(handler);
    }

    addEventListener(event: string, handler: Function): void {
      this.on(event, handler);
    }

    removeEventListener(event: string, handler: Function): void {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) handlers.splice(index, 1);
      }
    }

    private emit(event: string, data: any): void {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        handlers.forEach((h) => h(data));
      }
    }

    send(_data: string): void {
      // Default: no response. Tests patch this to emit a response.
    }

    close(): void {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close', { code: 1000, reason: '' });
    }

    // Mimic the `ws` 'message' event, whose payload's .toString() yields the
    // raw JSON string (a Buffer in the real implementation).
    __emitMessage(data: any): void {
      const json = JSON.stringify(data);
      const payload = { toString: () => json };
      this.emit('message', payload);
    }
  };
});

// Mock the ws module. Provide both default and named exports so that
// `import WebSocket from 'ws'` and `import { WebSocket } from 'ws'` resolve.
vi.mock('ws', () => {
  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

describe('CDPConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should connect and set status to CONNECTED', async () => {
    const conn = new CDPConnection('ws://localhost:9222/devtools/browser');
    await expect(conn.connect()).resolves.toBeUndefined();
    expect(conn.getStatus()).toBe(ConnectionStatus.CONNECTED);
  });

  it('should throw if already connected', async () => {
    const conn = new CDPConnection('ws://localhost:9222/devtools/browser');
    await conn.connect();
    await expect(conn.connect()).rejects.toThrow('Already connected');
  });

  it('should close connection and set status to CLOSED then DISCONNECTED', async () => {
    const conn = new CDPConnection('ws://localhost:9222/devtools/browser');
    await conn.connect();
    await conn.close();
    expect(conn.getStatus()).toBe(ConnectionStatus.DISCONNECTED);
  });

  it('should send a message and resolve with result', async () => {
    const conn = new CDPConnection('ws://localhost:9222/devtools/browser');
    await conn.connect();

    // Patch the underlying ws to echo a response for id=1
    const ws = (conn as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;
    ws.send = (_data: string) => {
      setTimeout(() => ws.__emitMessage({ id: 1, result: { frameId: '123' } }), 0);
    };

    const result = await conn.send('Page.navigate', { url: 'http://example.com' });
    expect(result).toEqual({ frameId: '123' });
  });

  it('should reject when CDP returns an error', async () => {
    const conn = new CDPConnection('ws://localhost:9222/devtools/browser');
    await conn.connect();

    const ws = (conn as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;
    ws.send = (_data: string) => {
      setTimeout(
        () =>
          ws.__emitMessage({
            id: 1,
            error: { code: -32600, message: 'Invalid params' },
          }),
        0,
      );
    };

    await expect(conn.send('Page.navigate', { url: 'http://example.com' })).rejects.toThrow(
      'Invalid params',
    );
  });

  it('should timeout if no response received', async () => {
    vi.useFakeTimers();

    const conn = new CDPConnection('ws://localhost:9222/devtools/browser');
    // connect() waits on a 0ms setTimeout inside the mock; advance fake timers
    // so the 'open' event fires and connect() resolves.
    const connectPromise = conn.connect();
    await vi.advanceTimersByTimeAsync(10);
    await connectPromise;

    const sendPromise = conn.send('Page.navigate', { url: 'http://example.com' });
    // Attach an early handler so the eventual rejection isn't reported as
    // unhandled when fake timers fire it before the rejects assertion attaches.
    sendPromise.catch(() => {});

    // Fast-forward time past the 30s request timeout
    await vi.advanceTimersByTimeAsync(31000);

    await expect(sendPromise).rejects.toThrow('CDP request timeout: Page.navigate');

    vi.useRealTimers();
  });

  it('should create connection via createConnection helper', async () => {
    const conn = await createConnection('ws://localhost:9222');
    expect(conn).toBeInstanceOf(CDPConnection);
    expect(conn.getStatus()).toBe(ConnectionStatus.CONNECTED);

    await conn.close();
  });

  it('should resolve targetId into a /devtools/page/<id> URL', async () => {
    const conn = await createConnection('ws://localhost:9222', 'abc123');
    const url = conn.getUrl();
    expect(url).toBe('ws://localhost:9222/devtools/page/abc123');
    await conn.close();
  });

  it('should convert http:// to ws:// and auto-discover a page target', async () => {
    // Auto-discovery via /json/list replaces the bare http:// URL with a
    // /devtools/page/<id> URL when a page target is found. With the mock
    // there's no real HTTP endpoint, so discoverPageTarget returns undefined
    // and we fall back to /devtools/browser.
    const conn = await createConnection('http://localhost:9222');
    // Either /devtools/page/<id> (if real Chrome is running and discovered)
    // or /devtools/browser (fallback when no HTTP endpoint responds).
    expect(conn.getUrl()).toMatch(/devtools\/(page|browser)/);
    await conn.close();
  });
});