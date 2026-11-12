// Storage management — read localStorage/sessionStorage over CDP's
// Runtime domain. Storage is origin-scoped, so this reads whatever origin
// the page is currently on (pass `origin` explicitly if known).

import type { CDPConnection } from './connection.js';
import type { Session } from './session.js';

type Conn = CDPConnection;

interface StorageData {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

interface StorageResult {
  origin: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

/** Read localStorage + sessionStorage for the page's current origin. */
export async function getStorage(
  session: Session,
  origin?: string,
): Promise<StorageResult> {
  const conn = await session.page();
  await conn.send('Runtime.enable');
  const script = `
    (() => {
      const ls = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        ls[key] = localStorage.getItem(key);
      }
      const ss = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        ss[key] = sessionStorage.getItem(key);
      }
      return { localStorage: ls, sessionStorage: ss };
    })()
  `;
  const result = await conn.send<{ result?: { value?: string } }>(
    'Runtime.evaluate',
    {
      expression: script,
      returnByValue: true,
    },
  );
  let storage: StorageData = { localStorage: {}, sessionStorage: {} };
  try {
    const parsed = JSON.parse(result?.result?.value ?? '{}');
    storage.localStorage = entriesToObject(parsed.localStorage);
    storage.sessionStorage = entriesToObject(parsed.sessionStorage);
  } catch {
    // ignore parse errors, return empty
  }
  return {
    origin: origin ?? '',
    localStorage: storage.localStorage ?? {},
    sessionStorage: storage.sessionStorage ?? {},
  };
}

/** Convert [[k,v],...] entries array to {k:v,...} object. */
function entriesToObject(input: unknown): Record<string, string> {
  if (!input || !Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const entry of input) {
    if (Array.isArray(entry) && entry.length >= 2) {
      out[String(entry[0])] = String(entry[1]);
    }
  }
  return out;
}
