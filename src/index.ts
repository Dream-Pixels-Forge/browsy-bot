// Browsy — Raw CDP Browser Automation (tool-agnostic core + adapters)
// Zero middleware, zero hidden state, explicit addressing.
//
// This entry point exposes the standalone library API. The OpenCode plugin
// lives in ./plugin.js; the MCP server in ./mcp.js; the CLI in ./cli.js.
// All of those build on the tool-agnostic core in ./core/.

import {
  CDPConnection,
  createConnection,
  navigate,
  captureScreenshot,
  evaluate,
} from './core/connection.js';
import {
  PageDomain,
  RuntimeDomain,
  PerformanceDomain,
  AccessibilityDomain,
  TargetDomain,
} from './core/domains.js';
import { ConnectionStatus } from './core/types.js';
import {
  click,
  fill,
  waitForSelector,
  pageText,
  pageTitle,
  currentUrl,
  screenshot,
  fullPageScreenshot,
  navigatePage,
  listTabs,
  newTab,
  closeTab,
} from './core/actions.js';
import { getSession, dropSession, closeAllSessions } from './core/session.js';

// Re-export the one-shot convenience helpers + domain classes.
export { navigate, captureScreenshot, evaluate, createConnection, CDPConnection };
export { PageDomain, RuntimeDomain, PerformanceDomain, AccessibilityDomain, TargetDomain };
// Public types the documented API surface depends on (session actions, tab info).
export type { TabInfo, WaitForOptions } from './core/actions.js';
export type { Session, SessionOptions } from './core/session.js';
export { click, fill, waitForSelector, pageText, pageTitle, currentUrl, screenshot, fullPageScreenshot, navigatePage, listTabs, newTab, closeTab };
export { getSession, dropSession, closeAllSessions };

// Main Browsy class — a thin object holding cached domain wrappers over one
// CDP connection.
export class Browsy {
  private connection: CDPConnection | null = null;
  private _page: PageDomain | null = null;
  private _runtime: RuntimeDomain | null = null;
  private _performance: PerformanceDomain | null = null;
  private _accessibility: AccessibilityDomain | null = null;
  private _target: TargetDomain | null = null;

  constructor(private browserUrl: string, private targetId?: string) {}

  async connect(): Promise<void> {
    this.connection = await createConnection(this.browserUrl, this.targetId);
    this._page = new PageDomain(this.connection);
    this._runtime = new RuntimeDomain(this.connection);
    this._performance = new PerformanceDomain(this.connection);
    this._accessibility = new AccessibilityDomain(this.connection);
    this._target = new TargetDomain(this.connection);
  }

  get page(): PageDomain {
    this.requireConnected();
    return this._page!;
  }

  get runtime(): RuntimeDomain {
    this.requireConnected();
    return this._runtime!;
  }

  get performance(): PerformanceDomain {
    this.requireConnected();
    return this._performance!;
  }

  get accessibility(): AccessibilityDomain {
    this.requireConnected();
    return this._accessibility!;
  }

  get target(): TargetDomain {
    this.requireConnected();
    return this._target!;
  }

  get isConnected(): boolean {
    return this.connection?.isConnected() ?? false;
  }

  getStatus(): ConnectionStatus {
    return this.connection?.getStatus() ?? ConnectionStatus.DISCONNECTED;
  }

  async close(): Promise<void> {
    await this.connection?.close();
    this.connection = null;
    this._page = this._runtime = this._performance = this._accessibility = this._target = null;
  }

  private requireConnected(): void {
    if (!this.connection?.isConnected()) {
      throw new Error('Browsy is not connected. Call await browsy.connect() first.');
    }
  }
}

// Factory function
export function createBrowsy(browserUrl: string, targetId?: string): Browsy {
  return new Browsy(browserUrl, targetId);
}

// Re-export the full type surface so library consumers can type their code.
export * from './core/types.js';

// OpenCode plugin entry point (see https://opencode.ai/docs/plugins/).
// Imported by adapters only — the core stays OpenCode-free.
export { BrowsyPlugin, default } from './plugin.js';
