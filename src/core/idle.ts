// waitForNetworkIdle — wait until the network is quiet.
//
// Enables the Network domain, tracks requestWillBeSent / responseReceived /
// loadingFailed, and resolves when no requests have been in flight for
// `idleMs`. Throws on `timeoutMs` if the network never settles.
//
// Useful for SPA navigations that settle via network activity rather than
// DOM presence.

import { CDPConnection } from './connection.js';
import type { Session } from './session.js';

type Conn = CDPConnection;

interface IdleOptions {
  /** ms of inactivity before resolving. Default 500. */
  idleMs?: number;
  /** Max ms to wait before throwing. Default 10000. */
  timeoutMs?: number;
}

/** Wait until the network is idle (no in-flight requests for idleMs). */
export async function waitForNetworkIdle(
  session: Session,
  options: IdleOptions = {},
): Promise<void> {
  const idleMs = options.idleMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 10000;
  const conn = await session.page();
  await conn.send('Network.enable');

  const inFlight = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  const deadline = Date.now() + timeoutMs;

  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const arm = () => {
    clearTimer();
    if (inFlight.size === 0) {
      resolve();
      return;
    }
    timer = setTimeout(() => {
      if (inFlight.size === 0) {
        resolve();
      }
    }, idleMs);
  };

  const timeout = setTimeout(() => {
    clearTimer();
    reject(new Error(`waitForNetworkIdle timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  conn.on('Network.requestWillBeSent', (msg: any) => {
    const id = msg.params?.requestId;
    if (id) inFlight.add(String(id));
    clearTimer();
    timer = setTimeout(() => {
      if (inFlight.size === 0) resolve();
    }, idleMs);
  });

  conn.on('Network.responseReceived', (msg: any) => {
    const id = msg.params?.requestId;
    if (id) inFlight.delete(String(id));
    arm();
  });

  conn.on('Network.loadingFailed', (msg: any) => {
    const id = msg.params?.requestId;
    if (id) inFlight.delete(String(id));
    arm();
  });

  try {
    await promise;
  } finally {
    clearTimeout(timeout);
    clearTimer();
  }
}
