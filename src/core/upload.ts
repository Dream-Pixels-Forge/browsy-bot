// File upload — set files on an `<input type="file">` element directly over CDP.
//
// Flow:
//   1. DOM.enable
//   2. DOM.resolveNode with the CSS selector -> objectId of the input node
//   3. DOM.setFileInputFiles with objectId + files array
//
// Returns undefined on success; throws with an actionable message when no
// file input matches the selector.

import { CDPConnection } from './connection.js';
import { DOM, Runtime } from './types.js';
import type { Session } from './session.js';

type Conn = CDPConnection;

async function page(session: Session): Promise<Conn> {
  return session.page();
}

async function ensureDomEnabled(conn: Conn): Promise<void> {
  await conn.send('DOM.enable');
}

/** Set the files of the first `<input type="file">` matching `selector`. */
export async function setFileInput(
  session: Session,
  selector: string,
  filePaths: string[],
): Promise<void> {
  const conn = await page(session);
  await ensureDomEnabled(conn);

  const resolved = await conn.send<DOM.ResolveNodeResult>('DOM.resolveNode', {
    selector,
  });
  const obj = resolved.object as { objectId?: string } | null;
  const objectId = obj?.objectId;
  if (!objectId) {
    throw new Error(
      `no file input found matching selector: ${selector}`,
    );
  }

  await conn.send('DOM.setFileInputFiles', {
    objectId,
    files: filePaths,
  });
}
