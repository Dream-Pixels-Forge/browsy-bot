// Frame handling — enter/exit iframe contexts over CDP.
//
// enterFrame(session, selector): resolves an iframe element via the DOM,
// maps it to a CDP frameId through the frame tree, and switches focus via
// Page.setFocusedFrame. Subsequent page-domain commands target the iframe.
// exitFrame(session): returns focus to the root (top-level) frame.
//
// Nested frames are supported: call enterFrame repeatedly to descend, and
// exitFrame to ascend one level at a time.

import { CDPConnection } from './connection.js';
import { DOM, Page } from './types.js';
import type { Session } from './session.js';

type Conn = CDPConnection;

async function page(session: Session): Promise<Conn> {
  return session.page();
}

async function ensureDomEnabled(conn: Conn): Promise<void> {
  await conn.send('DOM.enable');
}

/** Walk the frame tree to find the frame matching backendNodeId. */
function findFrameByBackendNodeId(
  tree: Page.FrameTree,
  backendNodeId: number,
): Page.Frame | undefined {
  if (tree.frame.backendNodeId === backendNodeId) return tree.frame;
  for (const child of tree.childFrames) {
    const found = findFrameByBackendNodeId(child, backendNodeId);
    if (found) return found;
  }
  return undefined;
}

/** Find the root frame (no parentFrameId). */
function findRootFrame(tree: Page.FrameTree): Page.Frame {
  if (!tree.frame.parentFrameId) return tree.frame;
  for (const child of tree.childFrames) {
    try {
      return findRootFrame(child);
    } catch {
      // continue
    }
  }
  throw new Error("no root frame found");
}

/** Enter an iframe context by CSS selector. Returns the frameId. */
export async function enterFrame(
  session: Session,
  selector: string,
): Promise<string> {
  const conn = await page(session);
  await ensureDomEnabled(conn);

  const resolved = await conn.send<DOM.ResolveNodeResult>('DOM.resolveNode', {
    selector,
  });
  const objectId = (resolved.object as { objectId?: string } | null)
    ?.objectId;
  if (!objectId) {
    throw new Error(`frame element not found: ${selector}`);
  }

  const owner = await conn.send<DOM.GetFrameOwnerResult>('DOM.getFrameOwner', {
    objectId,
  });
  const backendNodeId = owner.backendNodeId;

  const tree = await conn.send<Page.GetFrameTreeResult>('Page.getFrameTree', {
  });
  const frame = findFrameByBackendNodeId(tree.frameTree, backendNodeId);
  if (!frame) {
    throw new Error(`frame not found in CDP tree: ${selector}`);
  }

  await conn.send('Page.setFocusedFrame', { frameId: frame.frameId });
  return frame.frameId;
}

/** Exit the current frame context, returning to the root frame. */
export async function exitFrame(session: Session): Promise<void> {
  const conn = await page(session);
  const tree = await conn.send<Page.GetFrameTreeResult>('Page.getFrameTree', {
  });
  const root = findRootFrame(tree.frameTree);
  await conn.send('Page.setFocusedFrame', { frameId: root.frameId });
}
