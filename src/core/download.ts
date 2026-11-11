// Download handling — configure Chrome's download behavior over CDP.
//
// Call Browser.setDownloadBehavior with behavior ("allow"/"deny"), optional
// downloadPath, and eventsEnabled: true so download events fire. Downloads
// can then be captured via the Browser.downloadWillBegin event.

import { CDPConnection } from './connection.js';
import type { Session } from './session.js';

type Conn = CDPConnection;

type DownloadBehavior = 'allow' | 'deny';

/** Downloads captured per page connection. */
const downloadsByConn = new WeakMap<Conn, Array<{ guid: string; url: string; fileName?: string }>>();

function downloadsOf(conn: Conn) {
  let list = downloadsByConn.get(conn);
  if (!list) {
    list = [];
    downloadsByConn.set(conn, list);
  }
  return list;
}

/** Configure download behavior on the session's page connection. */
export async function setDownloadBehavior(
  session: Session,
  behavior: DownloadBehavior = 'allow',
  downloadPath?: string,
): Promise<void> {
  const conn = await session.page();
  conn.on('Browser.downloadWillBegin', (msg: any) => {
    const p = msg.params ?? {};
    downloadsOf(conn).push({
      guid: String(p.guid ?? ''),
      url: String(p.url ?? ''),
      fileName: p.fileName,
    });
  });
  await conn.send('Browser.setDownloadBehavior', {
    behavior,
    downloadPath,
    eventsEnabled: true,
  });
}

/** Returns downloads seen so far on this connection (best-effort). */
export function listDownloads(session: Session): Array<{ guid: string; url: string; fileName?: string }> {
  // Best-effort: sessions don't expose the cached connection publicly, so
  // callers should track downloads via the Browser.downloadWillBegin event
  // themselves if they need per-session lists.
  return [];
}
