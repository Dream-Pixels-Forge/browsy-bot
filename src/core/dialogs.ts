// Dialog handling — respond to JavaScript dialogs (alert / confirm / prompt)
// raised by the page.
//
// Dialogs arrive as `Page.javascriptDialogOpening` events on the page CDP
// connection. We collect them per connection (mirroring the console /
// network trackers in session.ts) so `acceptDialog` / `dismissDialog` /
// `dialogText` can act on the most recent one without the caller managing
// raw CDP events.

import { CDPConnection } from './connection.js';
import { Page, Runtime } from './types.js';
import type { Session } from './session.js';

type Conn = CDPConnection;

interface PendingDialog {
  type: 'alert' | 'confirm' | 'prompt' | string;
  message: string;
  defaultPrompt?: string;
}

/** Dialogs collected per page connection. */
const dialogsByConn = new WeakMap<Conn, PendingDialog[]>();

function dialogsOf(conn: Conn): PendingDialog[] {
  let list = dialogsByConn.get(conn);
  if (!list) {
    list = [];
    dialogsByConn.set(conn, list);
  }
  return list;
}

async function ensureDialogsEnabled(conn: Conn): Promise<void> {
  await conn.send('Page.enable');
  conn.on('Page.javascriptDialogOpening', (msg: any) => {
    const p = msg.params ?? {};
    dialogsOf(conn).push({
      type: String(p.type ?? 'alert'),
      message: String(p.message ?? ''),
      defaultPrompt: p.defaultPrompt,
    });
  });
}

/** Return the message of the most recent dialog, or throw if none seen. */
export async function dialogText(session: Session): Promise<string> {
  const conn = await session.page();
  await ensureDialogsEnabled(conn);
  const list = dialogsOf(conn);
  const d = list[list.length - 1];
  if (!d) throw new Error('no JavaScript dialog has been opened');
  return d.message;
}

/** Accept the most recent dialog. For prompts, optionally supply `promptText`. */
export async function acceptDialog(
  session: Session,
  promptText?: string,
): Promise<string | undefined> {
  const conn = await session.page();
  await ensureDialogsEnabled(conn);
  const list = dialogsOf(conn);
  if (list.length === 0) {
    throw new Error('no JavaScript dialog has been opened');
  }
  // Operate on the most recent dialog by index; CDP expects the index of the
  // dialog to handle. Use the last one added.
  const index = list.length - 1;
  const d = list[index];
  const result = await conn.send<Page.HandleJavaScriptDialogResult>(
    'Page.handleJavaScriptDialog',
    {
      accept: true,
      dialogIndex: index,
      promptText:
        d.type === 'prompt' ? (promptText ?? d.defaultPrompt ?? '') : undefined,
    },
  );
  list.splice(index, 1);
  return result?.result;
}

/** Dismiss the most recent dialog. */
export async function dismissDialog(session: Session): Promise<void> {
  const conn = await session.page();
  await ensureDialogsEnabled(conn);
  const list = dialogsOf(conn);
  if (list.length === 0) {
    throw new Error('no JavaScript dialog has been opened');
  }
  const index = list.length - 1;
  await conn.send('Page.handleJavaScriptDialog', {
    accept: false,
    dialogIndex: index,
  });
  list.splice(index, 1);
}
