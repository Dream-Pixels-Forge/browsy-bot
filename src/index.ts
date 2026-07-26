// Browsy - Raw CDP Browser Automation for OpenCode
// Zero middleware, zero hidden state, explicit addressing

import { CDPConnection, createConnection } from './connection.js';
import { PageDomain, RuntimeDomain, PerformanceDomain, AccessibilityDomain }
  from './domains.js';
import { ConnectionStatus } from './types.js';

// Convenience helpers are implemented in ./connection and re-exported here.
export { navigate, captureScreenshot, evaluate } from './connection.js';

// Main Browsy class
export class Browsy {
  private connection: CDPConnection | null = null;
  private _page: PageDomain | null = null;
  private _runtime: RuntimeDomain | null = null;
  private _performance: PerformanceDomain | null = null;
  private _accessibility: AccessibilityDomain | null = null;

  constructor(private browserUrl: string, private targetId?: string) {}

  async connect(): Promise<void> {
    this.connection = await createConnection(this.browserUrl, this.targetId);
    this._page = new PageDomain(this.connection);
    this._runtime = new RuntimeDomain(this.connection);
    this._performance = new PerformanceDomain(this.connection);
    this._accessibility = new AccessibilityDomain(this.connection);
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

  get isConnected(): boolean {
    return this.connection?.isConnected() ?? false;
  }

  getStatus(): ConnectionStatus {
    return this.connection?.getStatus() ?? ConnectionStatus.DISCONNECTED;
  }

  async close(): Promise<void> {
    await this.connection?.close();
    this.connection = null;
    this._page = this._runtime = this._performance = this._accessibility = null;
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

// Re-export types
export * from './types.js';
export * from './connection.js';
export { PageDomain, RuntimeDomain, PerformanceDomain, AccessibilityDomain } from './domains.js';

// OpenCode plugin entry point (see https://opencode.ai/docs/plugins/)
export { BrowsyPlugin, default } from './plugin.js';