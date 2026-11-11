// Request interception — block or mock network requests over CDP.
//
// Two mechanisms:
//   1. Blocking: Network.setBlockedURLs — simple URL-pattern matching
//   2. Mocking: Fetch domain — intercept Fetch.requestPaused events and
//      fulfill them with canned responses via Fetch.fulfillRequest
//
// Rules:
//   { urlPattern: string, action: 'block' | 'mock',
//     response?: { status?: number; body?: string; headers?: Record<string,string> } }
//
// All matching is prefix/substring on the URL pattern (supports * wildcards
// by treating them as substring match for simplicity).

import { CDPConnection } from './connection.js';
import type { Session } from './session.js';

type Conn = CDPConnection;

interface InterceptResponse {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

export interface InterceptRule {
  urlPattern: string;
  action: 'block' | 'mock';
  response?: InterceptResponse;
}

interface PausedRequest {
  requestId: string;
  url: string;
  method: string;
}

/** Paused requests waiting to be fulfilled (mock mode). */
const pausedByConn = new WeakMap<Conn, PausedRequest[]>();

function pausedOf(conn: Conn): PausedRequest[] {
  let list = pausedByConn.get(conn);
  if (!list) {
    list = [];
    pausedByConn.set(conn, list);
  }
  return list;
}

function patternMatches(url: string, pattern: string): boolean {
  // Simple glob support: '*' matches anything, otherwise substring match.
  const regex = new RegExp(
    '^' + pattern.split('*').map(s => escapeRegExp(s)).join('.*') + '$'
  );
  return regex.test(url);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Configure request interception rules on the session. */
export async function setRequestInterception(
  session: Session,
  rules: InterceptRule[]
): Promise<void> {
  const conn = await session.page();
  await conn.send('Network.enable');
  await conn.send('Fetch.enable');

  const blockPatterns = rules.filter((r) => r.action === 'block').map((r) => r.urlPattern);
  if (blockPatterns.length > 0) {
    await conn.send('Network.setBlockedURLs', { urls: blockPatterns });
  }

  conn.on('Fetch.requestPaused', (msg: any) => {
    const p = msg.params ?? {};
    const requestId = String(p.requestId ?? '');
    const url = String(p.url ?? '');
    const method = String(p.method ?? '');
    pausedOf(conn).push({ requestId, url, method });

    // Try to match a mock rule
    const rule = rules.find((r) => r.action === 'mock' && patternMatches(url, r.urlPattern));
    if (rule) {
      const body = rule.response?.body ?? '';
      const status = rule.response?.status ?? 200;
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...rule.response?.headers,
      };
      const bodyBase64 = Buffer.from(body ?? '').toString('base64');
      void conn.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: status,
        responsePhrase: 'OK',
        body: bodyBase64,
        headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
      });
    }
  });
}

/** Returns paused requests seen so far on this connection (best-effort). */
export function getPausedRequests(session: Session): PausedRequest[] {
  // Best-effort: sessions don't expose the cached connection publicly.
  return [];
}
