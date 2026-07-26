import type {
  Page,
  Runtime,
  Performance,
  Accessibility,
} from './types.js';

type Connection = { send<T = any>(method: string, params?: any): Promise<T> };

export class PageDomain {
  constructor(private connection: Connection) {}

  async navigate(params: Page.NavigateParams): Promise<Page.NavigateResult> {
    return this.connection.send('Page.navigate', params);
  }

  async captureScreenshot(
    params: Page.CaptureScreenshotParams = {},
  ): Promise<Page.CaptureScreenshotResult> {
    return this.connection.send('Page.captureScreenshot', params);
  }

  async reload(params: { hard?: boolean; ignoreCache?: boolean } = {}): Promise<any> {
    return this.connection.send('Page.reload', params);
  }

  async bringToFront(): Promise<any> {
    return this.connection.send('Page.bringToFront', {});
  }

  async getLayoutMetrics(): Promise<Page.GetLayoutMetricsResult> {
    return this.connection.send('Page.getLayoutMetrics', {});
  }
}

export class RuntimeDomain {
  constructor(private connection: Connection) {}

  async evaluate(params: Runtime.EvaluateParams): Promise<Runtime.EvaluateResult> {
    return this.connection.send('Runtime.evaluate', params);
  }

  async releaseObjectGroup(params: { objectGroup: string }): Promise<any> {
    return this.connection.send('Runtime.releaseObjectGroup', params);
  }
}

export class PerformanceDomain {
  constructor(private connection: Connection) {}

  async enable(): Promise<Performance.EnableResult> {
    return this.connection.send('Performance.enable', {});
  }

  async disable(): Promise<Performance.DisableResult> {
    return this.connection.send('Performance.disable', {});
  }

  async getMetrics(): Promise<Performance.GetMetricsResult> {
    return this.connection.send('Performance.getMetrics', {});
  }
}

export class AccessibilityDomain {
  constructor(private connection: Connection) {}

  async getFullAXTree(): Promise<Accessibility.GetFullAXTreeResult> {
    return this.connection.send('Accessibility.getFullAXTree', {});
  }
}

export function getPageDomain(connection: Connection) {
  return new PageDomain(connection);
}

export function getRuntimeDomain(connection: Connection) {
  return new RuntimeDomain(connection);
}

export function getPerformanceDomain(connection: Connection) {
  return new PerformanceDomain(connection);
}

export function getAccessibilityDomain(connection: Connection) {
  return new AccessibilityDomain(connection);
}