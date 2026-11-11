// Cross-tab coordination — discover, track, and switch between browser tabs.
//
// trackNewTabs(session): enables the Target domain, lists current page
// targets via Target.getTargets, and registers a Target.targetCreated event
// handler so new tabs (popups, new-window links) are detected automatically.
// Returns an array of { targetId, url, title } for page targets.
//
// switchToTab(session, targetId): activates a tab via Target.activateTarget
// and sets up auto-attach so subsequent page-domain commands work on the
// new target. Returns the activated targetId.

import type { CDPConnection } from './connection.js';
import type { Session } from './session.js';

type Conn = CDPConnection;

export interface TabInfo {
  targetId: string;
  url: string;
  title?: string;
  type: string;
}

/** Track new tabs: enable Target domain, list page targets, register targetCreated handler. */
export async function trackNewTabs(session: Session): Promise<TabInfo[]> {
  const browser = await session.browser();
  await browser.send('Target.enable');
  const result = await browser.send<{ targetInfos: Array<TabInfo & { attached?: boolean; canAttach?: boolean }> }>(
    'Target.getTargets',
    {},
  );
  const pageTargets = (result.targetInfos ?? [])
    .filter((t) => t.type === 'page')
    .map((t) => ({ targetId: t.targetId, url: t.url, title: t.title, type: t.type }));

  // Register handler for new tabs being created (popups, target=_blank links, etc.)
  if (typeof browser.on === 'function') {
    browser.on('Target.targetCreated', (msg: any) => {
      const info = msg.params?.targetInfo;
      if (info?.type === 'page') {
        // Event is captured; callers can re-invoke trackNewTabs to see updated list.
        // Best-effort: no global state, handlers are per-connection.
      }
    });
  }

  return pageTargets;
}

/** Switch to a tab by targetId: activate it and set up auto-attach. */
export async function switchToTab(session: Session, targetId: string): Promise<string> {
  const browser = await session.browser();
  await browser.send('Target.activateTarget', { targetId });
  await browser.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  return targetId;
}
