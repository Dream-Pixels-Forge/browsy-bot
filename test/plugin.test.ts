import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowsyPlugin } from '../src/plugin.js';
import { navigate, captureScreenshot, evaluate } from '../src/connection.js';
import { remember, recall, isMemoriusAvailable } from '../src/memorius.js';

vi.mock('../src/connection.js', () => ({
  navigate: vi.fn(),
  captureScreenshot: vi.fn(),
  evaluate: vi.fn(),
}));

vi.mock('../src/memorius.js', () => ({
  remember: vi.fn(),
  recall: vi.fn(),
  isMemoriusAvailable: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => ''),
  };
});

function makeInput(overrides = {}) {
  return {
    $: { tag: 'SHELL' },
    client: {
      app: {
        log: vi.fn(),
      },
    },
    ...overrides,
  };
}

describe('BrowsyPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with default options', async () => {
    const plugin = await BrowsyPlugin(makeInput(), {});
    expect(plugin).toBeDefined();
    expect(plugin.tool).toBeDefined();
    expect(plugin['tool.execute.after']).toBeDefined();
  });

  it('logs initialization info', async () => {
    const input = makeInput();
    await BrowsyPlugin(input, { url: 'ws://localhost:9222', remember: true });
    expect(input.client.app.log).toHaveBeenCalledTimes(1);
    const logCall = input.client.app.log.mock.calls[0][0];
    expect(logCall.body.service).toBe('browsy-plugin');
    expect(logCall.body.level).toBe('info');
    expect(logCall.body.extra.url).toBe('ws://localhost:9222');
  });

  it('does not fail when logging throws', async () => {
    const input = makeInput({
      client: {
        app: {
          log: () => {
            throw new Error('log failed');
          },
        },
      },
    });
    await expect(BrowsyPlugin(input, {})).resolves.toBeDefined();
  });

  describe('tool.execute.after hook', () => {
    it('stores a memory after successful browsy_* tool calls when remember is true', async () => {
      const plugin = await BrowsyPlugin(makeInput(), { remember: true });
      const afterHook = plugin['tool.execute.after'] as any;
      await afterHook(
        { tool: 'browsy_navigate', sessionID: 's1' },
        { result: 'Navigated to https://example.com' },
      );
      expect(remember).toHaveBeenCalledWith(
        { tag: 'SHELL' },
        {
          content: 'browsy_navigate on session s1: ok',
          shelf: 'browsy',
          folder: 's1',
        },
        { vault: 'main', shelf: 'browsy' },
      );
    });

    it('skips non-browsy tools', async () => {
      const plugin = await BrowsyPlugin(makeInput(), { remember: true });
      const afterHook = plugin['tool.execute.after'] as any;
      await afterHook({ tool: 'some_other_tool', sessionID: 's1' }, {});
      expect(remember).not.toHaveBeenCalled();
    });

    it('does not store when remember is false', async () => {
      const plugin = await BrowsyPlugin(makeInput(), { remember: false });
      const afterHook = plugin['tool.execute.after'] as any;
      await afterHook({ tool: 'browsy_navigate', sessionID: 's1' }, {});
      expect(remember).not.toHaveBeenCalled();
    });
  });

  describe('browsy_navigate', () => {
    it('calls navigate with default url and targetId', async () => {
      const plugin = await BrowsyPlugin(makeInput(), { url: 'ws://localhost:9222', targetId: 'tab1' });
      const result = await plugin.tool.browsy_navigate.execute({ url: 'https://example.com' });
      expect(navigate).toHaveBeenCalledWith('ws://localhost:9222', 'https://example.com', 'tab1');
      expect(result).toBe('Navigated to https://example.com');
    });

    it('calls navigate with overridden browserUrl and targetId', async () => {
      const plugin = await BrowsyPlugin(makeInput(), { url: 'ws://localhost:9222' });
      await plugin.tool.browsy_navigate.execute({
        url: 'https://example.com',
        browserUrl: 'ws://other:9222',
        targetId: 'tab2',
      });
      expect(navigate).toHaveBeenCalledWith('ws://other:9222', 'https://example.com', 'tab2');
    });
  });

  describe('browsy_screenshot', () => {
    it('returns base64 when no outputPath is given', async () => {
      (captureScreenshot as any).mockResolvedValue('BASE64DATA');
      const plugin = await BrowsyPlugin(makeInput(), {});
      const result = await plugin.tool.browsy_screenshot.execute({});
      expect(captureScreenshot).toHaveBeenCalled();
      expect(result).toEqual({
        title: 'Screenshot captured',
        output: 'BASE64DATA',
        metadata: { format: 'png', base64: true },
      });
    });

    it('writes to file when outputPath is given', async () => {
      (captureScreenshot as any).mockResolvedValue('BASE64DATA');
      const plugin = await BrowsyPlugin(makeInput(), {});
      const ctx = { directory: '/project' };
      const out = require('path').join(ctx.directory, 'shot.png');
      const result = await plugin.tool.browsy_screenshot.execute(
        { outputPath: 'shot.png' },
        ctx,
      );
      expect(result).toEqual({
        title: 'Screenshot saved',
        output: out,
        attachments: [
          {
            type: 'file',
            mime: 'image/png',
            url: out,
            filename: 'shot.png',
          },
        ],
      });
    });
  });

  describe('browsy_evaluate', () => {
    it('returns string value directly', async () => {
      (evaluate as any).mockResolvedValue('Example Domain');
      const plugin = await BrowsyPlugin(makeInput(), {});
      const result = await plugin.tool.browsy_evaluate.execute({
        expression: 'document.title',
      });
      expect(evaluate).toHaveBeenCalled();
      expect(result).toBe('Example Domain');
    });

    it('returns JSON for objects', async () => {
      (evaluate as any).mockResolvedValue({ a: 1 });
      const plugin = await BrowsyPlugin(makeInput(), {});
      const result = await plugin.tool.browsy_evaluate.execute({
        expression: '({a:1})',
      });
      expect(result).toBe('{\n  "a": 1\n}');
    });

    it('returns "undefined" for undefined values', async () => {
      (evaluate as any).mockResolvedValue(undefined);
      const plugin = await BrowsyPlugin(makeInput(), {});
      const result = await plugin.tool.browsy_evaluate.execute({
        expression: 'void 0',
      });
      expect(result).toBe('undefined');
    });
  });

  describe('browsy_recall', () => {
    it('returns formatted memories when memorius is available', async () => {
      (isMemoriusAvailable as any).mockResolvedValue(true);
      (recall as any).mockResolvedValue({
        available: true,
        hits: [
          { content: '.save selector worked', score: 0.92 },
          { content: '/login flow', score: 0.81 },
        ],
      });
      const plugin = await BrowsyPlugin(makeInput(), {});
      const result = await plugin.tool.browsy_recall.execute({ query: 'save button', n: 5 });
      expect(result).toBe(
        'Recalled 2 memories:\n' +
        '  1. .save selector worked (score: 0.92)\n' +
        '  2. /login flow (score: 0.81)',
      );
    });

    it('returns no-match message when memorius returns empty', async () => {
      (isMemoriusAvailable as any).mockResolvedValue(true);
      (recall as any).mockResolvedValue({ available: true, hits: [] });
      const plugin = await BrowsyPlugin(makeInput(), {});
      const result = await plugin.tool.browsy_recall.execute({ query: 'nothing' });
      expect(result).toBe('No matching memories found.');
    });

    it('returns unavailable message when memorius is down', async () => {
      (isMemoriusAvailable as any).mockResolvedValue(false);
      (recall as any).mockResolvedValue({ available: false, raw: '' });
      const plugin = await BrowsyPlugin(makeInput(), {});
      const result = await plugin.tool.browsy_recall.execute({ query: 'anything' });
      expect(result).toBe('memorius is unavailable — no prior learnings recalled.');
    });
  });
});
