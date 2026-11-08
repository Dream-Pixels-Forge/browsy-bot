#!/usr/bin/env node

/**
 * Browsy CLI - Command-line interface for CDP operations.
 *
 * Usage: browsy <command> [options] [--json]
 *
 * Commands:
 *   navigate <url>            Navigate a tab to a URL
 *   open <url>                Navigate and bring to front (alias of navigate)
 *   screenshot [options]      Capture screenshot (PNG base64 or file)
 *   eval <expression>         Evaluate JavaScript in the page
 *   wait <selector>          Poll until a selector exists
 *   click <selector>          Click the first element matching the selector
 *   fill <selector> <value>   Set a form control's value
 *   page-text                 Print the page's visible text
 *   console                   Dump captured console entries
 *   network                   Dump captured network requests
 *   tabs                      List open tabs
 *   new-tab [url]             Open a new tab
 *   close-tab <id>            Close a tab
 *   extract <selector> [f...] Pull structured records (text/attr/value)
 *   doctor                    Diagnostics: endpoint, binary, memorius
 *   ensure-browser            Launch a dedicated CDP browser if needed
 *   stop-browser              Stop a browser started by ensure-browser
 *   mcp                       Run the MCP stdio server
 *
 * click/fill accept --trusted to use renderer-trusted CDP input events
 * (Input.dispatchMouseEvent / Input.insertText) instead of JS dispatch.
 *
 * Global:
 *   -u, --url <url>           CDP endpoint (default $BROWSY_URL or ws://localhost:9222)
 *   -t, --target <id>         Default target/tab id
 *   -j, --json                Machine-readable JSON output
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import {
  navigate as oneShotNavigate,
  captureScreenshot as oneShotScreenshot,
  evaluate as oneShotEvaluate,
} from './core/connection.js';
import { getSession, closeAllSessions } from './core/session.js';
import {
  click,
  fill,
  waitForSelector,
  pageText,
  screenshot as sessionScreenshot,
  fullPageScreenshot,
  navigatePage,
  listTabs as sessionListTabs,
  switchTab,
  foreachTab,
  interceptNetwork,
  mockResponse,
  continueInterceptedRequest,
  runScript,
  ScriptStep,
  getCookies,
  setCookie,
  deleteCookie,
  saveCookies,
  loadCookies,
  visualDiff,
} from './core/actions.js';
import { startMcpServer } from './mcp.js';
import { extract } from './core/extract.js';
import { doctor } from './core/diagnostics.js';
import { ensureBrowser, stopBrowser } from './core/browser.js';
import { Runtime } from './core/types.js';

const DEFAULT_BROWSER_URL = () => process.env.BROWSY_URL ?? 'ws://localhost:9222';

// --- command result types ---------------------------------------------------

export interface CliContext {
  browserUrl: string;
  targetId?: string;
  json: boolean;
}

export interface CommandResult {
  ok: boolean;
  data: unknown;
  /** Human-readable one-liner (ignored when --json is set). */
  message: string;
}

/**
 * The command driver. Pure-ish: takes a subcommand + raw args + context and
 * returns a structured result. This is what tests drive with a mocked
 * core; the commander actions below just adapt CLI args and print.
 */
export async function runCommand(
  name: string,
  args: Record<string, string | number | boolean | undefined>,
  ctx: CliContext,
): Promise<CommandResult> {
  switch (name) {
    case 'navigate':
    case 'open': {
      const url = String(args.url ?? args._url ?? '');
      if (!url) throw new CliUsageError('navigate requires a URL');
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      await navigatePage(session, url);
      return { ok: true, data: { url }, message: `Navigated to ${url}` };
    }

    case 'screenshot': {
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      const options = {
        format: (args.format as 'png' | 'jpeg' | undefined) ?? 'png',
        quality: typeof args.quality === 'number' ? args.quality : undefined,
      };
      const data = args.full
        ? await fullPageScreenshot(session, options)
        : await sessionScreenshot(session, options);
      if (args.output) {
        const out = path.isAbsolute(String(args.output))
          ? String(args.output)
          : path.join(process.cwd(), String(args.output));
        fs.writeFileSync(out, Buffer.from(data, 'base64'));
        return { ok: true, data: { savedTo: out }, message: `Screenshot saved to ${out}` };
      }
      return { ok: true, data: { base64: data, format: options.format }, message: 'Screenshot captured' };
    }

    case 'eval': {
      const expression = String(args.expression ?? '');
      if (!expression) throw new CliUsageError('eval requires an expression');
      const result = await oneShotEvaluate(ctx.browserUrl, expression, ctx.targetId);
      return { ok: true, data: result, message: JSON.stringify(result?.result ?? result) };
    }

    case 'wait': {
      const selector = String(args.selector ?? '');
      if (!selector) throw new CliUsageError('wait requires a selector');
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      await waitForSelector(session, selector, {
        timeoutMs: typeof args.timeout === 'number' ? args.timeout : 10000,
        intervalMs: typeof args.interval === 'number' ? args.interval : 100,
        fallbacks: args.fallback ? String(args.fallback).split(',') : undefined,
      });
      return { ok: true, data: { selector }, message: `Found ${selector}` };
    }

    case 'click': {
      const selector = String(args.selector ?? '');
      if (!selector) throw new CliUsageError('click requires a selector');
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      const clicked = await click(session, selector, {
        trusted: Boolean(args.trusted),
        fallbacks: args.fallback ? String(args.fallback).split(',') : undefined,
      });
      return {
        ok: clicked,
        data: { clicked, selector, trusted: Boolean(args.trusted) },
        message: clicked ? `Clicked ${selector}` : `No element matched ${selector}`,
      };
    }

    case 'fill': {
      const selector = String(args.selector ?? '');
      if (!selector) throw new CliUsageError('fill requires a selector');
      const value = String(args.value ?? '');
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      const filled = await fill(session, selector, value, {
        trusted: Boolean(args.trusted),
        fallbacks: args.fallback ? String(args.fallback).split(',') : undefined,
      });
      return {
        ok: filled,
        data: { filled, selector, value, trusted: Boolean(args.trusted) },
        message: filled ? `Filled ${selector}` : `No element matched ${selector}`,
      };
    }

    case 'page-text': {
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      const text = await pageText(session);
      return { ok: true, data: { text }, message: text };
    }

    case 'console': {
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      const entries = session.captureConsole();
      return { ok: true, data: entries, message: `${entries.length} console entr${entries.length === 1 ? 'y' : 'ies'}` };
    }

    case 'network': {
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      const entries = session.captureNetwork();
      return { ok: true, data: entries, message: `${entries.length} network request${entries.length === 1 ? '' : 's'}` };
    }

    case 'tabs': {
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      const tabs = await sessionListTabs(session);
      return { ok: true, data: tabs, message: `${tabs.length} tab${tabs.length === 1 ? '' : 's'}` };
    }

    case 'new-tab': {
      const url = args.url ? String(args.url) : undefined;
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      const targetId = await session.newTab(url);
      return { ok: true, data: { targetId, url: url ?? 'about:blank' }, message: `Opened tab ${targetId}` };
    }

    case 'close-tab': {
      const id = String(args.id ?? '');
      if (!id) throw new CliUsageError('close-tab requires a target id');
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      await session.closeTab(id);
      return { ok: true, data: { targetId: id }, message: `Closed tab ${id}` };
    }

    case 'switch-tab': {
      const id = String(args.id ?? '');
      if (!id) throw new CliUsageError('switch-tab requires a target id');
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      await switchTab(session, id);
      return { ok: true, data: { targetId: id }, message: `Switched to tab ${id}` };
    }

    case 'broadcast': {
      const selector = String(args.selector ?? '');
      const action = String(args.action ?? '');
      if (!selector) throw new CliUsageError('broadcast requires a selector');
      if (!action) throw new CliUsageError('broadcast requires an action (click, fill, eval)');
      if (action === 'fill') {
        const value = String(args.value ?? '');
        if (!value) throw new CliUsageError('broadcast fill requires a value');
      }
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      const results = await foreachTab(session, async (s, targetId) => {
        switch (action) {
          case 'click':
            return { targetId, result: await click(s, selector, { trusted: Boolean(args.trusted) }) };
          case 'fill':
            return { targetId, result: await fill(s, selector, String(args.value ?? ''), { trusted: Boolean(args.trusted) }) };
          case 'eval':
            const expr = String(args.expression ?? '');
            if (!expr) throw new CliUsageError('broadcast eval requires an expression');
            return { targetId, result: await s.page().then(c => c.send('Runtime.evaluate', { expression: expr, returnByValue: true })) };
          default:
            throw new CliUsageError(`Unknown broadcast action: ${action}. Use click, fill, or eval`);
        }
      });
      return { ok: true, data: results, message: `Broadcast ${action} to ${results.length} tab${results.length === 1 ? '' : 's'}` };
    }

    case 'cookies': {
      const subcommand = String(args.subcommand ?? '');
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });

      if (subcommand === 'get') {
        const urls = args.urls ? String(args.urls).split(',') : undefined;
        const cookies = await getCookies(session, urls);
        return { ok: true, data: cookies, message: `${cookies.length} cookie${cookies.length === 1 ? '' : 's'}` };
      }

      if (subcommand === 'set') {
        const name = String(args.name ?? '');
        const value = String(args.value ?? '');
        if (!name || !value) throw new CliUsageError('cookies set requires --name and --value');
        const result = await setCookie(session, {
          name,
          value,
          domain: args.domain ? String(args.domain) : undefined,
          path: args.path ? String(args.path) : undefined,
          secure: args.secure === true,
          httpOnly: args.httponly === true,
          sameSite: args.samesite ? (String(args.samesite) as 'Strict' | 'Lax' | 'None') : undefined,
          expires: args.expires ? Number(args.expires) : undefined,
        });
        return { ok: result.success, data: result, message: result.success ? `Cookie ${name} set` : `Failed to set cookie ${name}` };
      }

      if (subcommand === 'delete') {
        const name = String(args.name ?? '');
        if (!name) throw new CliUsageError('cookies delete requires --name');
        await deleteCookie(session, { name });
        return { ok: true, data: { name }, message: `Cookie ${name} deleted` };
      }

      if (subcommand === 'save') {
        const file = String(args.file ?? '');
        if (!file) throw new CliUsageError('cookies save requires --file');
        await saveCookies(session, file);
        return { ok: true, data: { file }, message: `Cookies saved to ${file}` };
      }

      if (subcommand === 'load') {
        const file = String(args.file ?? '');
        if (!file) throw new CliUsageError('cookies load requires --file');
        await loadCookies(session, file);
        return { ok: true, data: { file }, message: `Cookies loaded from ${file}` };
      }

      throw new CliUsageError('cookies requires a subcommand: get, set, delete, save, or load');
    }

    case 'extract': {
      const selector = String(args.selector ?? '');
      if (!selector) throw new CliUsageError('extract requires a selector');
      // Commander variadic: args.fields is the [field...] array (possibly empty).
      const fields: string[] =
        Array.isArray(args.fields) && (args.fields as string[]).length > 0
          ? (args.fields as string[])
          : ['text'];
      const limit = typeof args.limit === 'number' ? args.limit : undefined;
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      const records = await extract(session, selector, fields, {
        limit,
        fallbacks: args.fallback ? String(args.fallback).split(',') : undefined,
      });
      return {
        ok: true,
        data: records,
        message: `${records.length} record${records.length === 1 ? '' : 's'} for ${selector}`,
      };
    }

    case 'heal': {
      const selector = String(args.selector ?? '');
      if (!selector) throw new CliUsageError('heal requires a selector');
      const url = args.url ? String(args.url) : undefined;
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      if (url) {
        await navigatePage(session, url);
      }
      const conn = await session.page();
      const suggestions = await conn.send<{ result?: Runtime.RemoteObject; exceptionDetails?: Runtime.ExceptionDetails }>(
        'Runtime.evaluate',
        {
          expression: `(function(){
            const target = ${JSON.stringify(selector)};
            const el = document.querySelector(target);
            if (el) return { matched: true, selector: target, tag: el.tagName, id: el.id, classes: [...el.classList] };
            
            // Try common alternatives
            const alternatives = [];
            const all = document.querySelectorAll('*');
            for (const e of all) {
              const tag = e.tagName.toLowerCase();
              const id = e.id ? '#' + e.id : '';
              const classes = [...e.classList].map(c => '.' + c).join('');
              const role = e.getAttribute('role') ? '[role="' + e.getAttribute('role') + '"]' : '';
              const testId = e.getAttribute('data-testid') ? '[data-testid="' + e.getAttribute('data-testid') + '"]' : '';
              const name = e.getAttribute('name') ? '[name="' + e.getAttribute('name') + '"]' : '';
              const placeholder = e.getAttribute('placeholder') ? '[placeholder="' + e.getAttribute('placeholder') + '"]' : '';
              const type = e.getAttribute('type') ? '[type="' + e.getAttribute('type') + '"]' : '';
              
              if (id) alternatives.push(tag + id);
              if (classes) alternatives.push(tag + classes);
              if (role) alternatives.push(tag + role);
              if (testId) alternatives.push(tag + testId);
              if (name) alternatives.push(tag + name);
              if (placeholder) alternatives.push(tag + placeholder);
              if (type) alternatives.push(tag + type);
            }
            return { matched: false, selector: target, alternatives: [...new Set(alternatives)].slice(0, 20) };
          })()`,
          returnByValue: true,
        },
      );
      if (suggestions.exceptionDetails) {
        throw new Error('heal: page JS threw');
      }
      const data = suggestions.result?.value as { matched: boolean; selector: string; tag?: string; id?: string; classes?: string[]; alternatives?: string[] } | undefined;
      if (data?.matched) {
        return { ok: true, data, message: `Selector "${selector}" matched: <${data.tag}${data.id ? '#' + data.id : ''}${data.classes ? '.' + data.classes.join('.') : ''}>` };
      }
      return { ok: false, data, message: `Selector "${selector}" did not match. Suggestions: ${data?.alternatives?.join(', ') || 'none'}` };
    }

    case 'doctor': {
      const report = await doctor(ctx.browserUrl);
      return {
        ok: report.ready,
        data: report,
        message: report.ready
          ? `ready: ${report.endpoint.pageTargets} page target${report.endpoint.pageTargets === 1 ? '' : 's'}`
          : `not ready: ${report.suggestions[0] ?? 'see report'}`,
      };
    }

    case 'ensure-browser': {
      const port = typeof args.port === 'number' ? args.port : undefined;
      const binary = args.binary ? String(args.binary) : undefined;
      const headless = typeof args.headless === 'boolean' ? args.headless : undefined;
      const result = await ensureBrowser({ port, binary, headless });
      if (result.launched && result.handle) {
        return {
          ok: true,
          data: result,
          message: `Launched ${result.handle.binary} (pid ${result.handle.pid}) at ${result.browserUrl}`,
        };
      }
      return {
        ok: true,
        data: result,
        message: `Endpoint already up: ${result.browserUrl} (${result.note ?? 'reachable'})`,
      };
    }

    case 'stop-browser': {
      const port = typeof args.port === 'number' ? args.port : undefined;
      const result = stopBrowser({ port });
      // A stopped or already-stale browser is a success (nothing left running);
      // a missing pidfile with no recorded browser is also benign.
      return {
        ok: result.stopped,
        data: result,
        message: result.stopped
          ? `Stopped browser (pid ${result.pid})`
          : `No browser to stop: ${result.reason ?? 'unknown'}`,
      };
    }

    case 'run': {
      const scriptFile = String(args.script ?? '');
      if (!scriptFile) throw new CliUsageError('run requires a script file');
      const fs = await import('fs');
      const path = await import('path');
      const scriptPath = path.isAbsolute(scriptFile) ? scriptFile : path.join(process.cwd(), scriptFile);
      if (!fs.existsSync(scriptPath)) throw new CliUsageError(`Script file not found: ${scriptPath}`);
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
      let steps: ScriptStep[];
      if (scriptPath.endsWith('.json')) {
        steps = JSON.parse(scriptContent);
      } else if (scriptPath.endsWith('.yaml') || scriptPath.endsWith('.yml')) {
        const yaml = await import('js-yaml');
        steps = yaml.load(scriptContent) as ScriptStep[];
      } else {
        throw new CliUsageError('Script file must be .json or .yaml/.yml');
      }
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      const results = await runScript(session, steps);
      const failed = results.find(r => !r.ok);
      return { ok: !failed, data: results, message: failed ? `Script failed at step ${failed.step}: ${failed.error}` : `Script completed: ${results.length} steps` };
    }

    case 'intercept': {
      const pattern = String(args.pattern ?? '');
      if (!pattern) throw new CliUsageError('intercept requires --pattern');
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      await interceptNetwork(session, [{ urlPattern: pattern }]);
      return { ok: true, data: { pattern }, message: `Intercepting requests matching: ${pattern}` };
    }

    case 'mock': {
      const pattern = String(args.pattern ?? '');
      const status = typeof args.status === 'number' ? args.status : 200;
      const body = args.body ? String(args.body) : '{}';
      const contentType = args.contenttype ? String(args.contenttype) : 'application/json';
      if (!pattern) throw new CliUsageError('mock requires --pattern');
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      await mockResponse(session, pattern, { status, body, contentType });
      return { ok: true, data: { pattern, status, body, contentType }, message: `Mocking ${pattern} -> ${status} ${contentType}` };
    }

    case 'continue-request': {
      const interceptionId = String(args.id ?? '');
      const action = String(args.action ?? 'continue');
      if (!interceptionId) throw new CliUsageError('continue-request requires --id');
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      await continueInterceptedRequest(session, interceptionId, action as 'continue' | 'mock' | 'fail', {
        url: args.url ? String(args.url) : undefined,
        method: args.method ? String(args.method) : undefined,
        postData: args.postdata ? String(args.postdata) : undefined,
        headers: args.headers ? JSON.parse(String(args.headers)) : undefined,
        response: args.response ? JSON.parse(String(args.response)) : undefined,
      });
      return { ok: true, data: { interceptionId, action }, message: `Request ${interceptionId} ${action}ed` };
    }

    case 'visual-diff': {
      const baseline = String(args.baseline ?? '');
      if (!baseline) throw new CliUsageError('visual-diff requires --baseline');
      const session = await getSession(ctx.browserUrl, { targetId: ctx.targetId });
      const result = await visualDiff(session, {
        baselinePath: baseline,
        currentPath: args.current ? String(args.current) : undefined,
        threshold: args.threshold ? Number(args.threshold) : undefined,
        outputPath: args.output ? String(args.output) : undefined,
      });
      return {
        ok: !result.changed,
        data: result,
        message: result.changed
          ? `Visual change detected: ${result.diffPercentage.toFixed(2)}% different (${result.diffPixels} pixels)`
          : 'No visual changes detected',
      };
    }

    default:
      throw new CliUsageError(`Unknown command: ${name}`);
  }
}

/** Usage errors (bad args / unknown command) map to exit code 2. */
export class CliUsageError extends Error {}

/** CDP connection errors map to exit code 3. */
function isCdpError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message;
  return /CDP|ECONNREFUSED|not connected|WebSocket|connection closed|getaddrinfo|socket/i.test(msg);
}

// --- commander wiring --------------------------------------------------------

function buildProgram(): Command {
  const program = new Command();
  program
    .name('browsy')
    .description('Raw CDP browser automation — universal CLI + MCP server')
    .version('0.2.0')
    .option('-u, --url <url>', 'Chrome DevTools WebSocket URL', DEFAULT_BROWSER_URL())
    .option('-t, --target <id>', 'Default target/tab id', '')
    .option('-j, --json', 'Machine-readable JSON output', false);

  const ctx = (): CliContext => {
    const o = program.opts() as { url?: string; target?: string; json?: boolean };
    return {
      browserUrl: o.url ?? DEFAULT_BROWSER_URL(),
      targetId: o.target || undefined,
      json: Boolean(o.json),
    };
  };

  // Every action routes through runCommand and adapts the output.
  // Commander's documented call signature is (positionals..., options, command).
  // We slice by argNames.length to grab positional args and treat the next
  // arg as the subcommand options object.
  const act =
    (name: string, argNames: string[] = []) =>
    async (...raw: any[]) => {
      const c = ctx();
      const positional: any[] = raw.slice(0, argNames.length);
      const subOpts: Record<string, any> = raw[argNames.length] ?? {};
      const args: Record<string, string | number | boolean | undefined> = { ...subOpts };
      argNames.forEach((n, i) => {
        if (positional[i] !== undefined) args[n] = positional[i];
      });
      args._url = positional[0];
      try {
        const result = await runCommand(name, args, c);
        if (c.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else {
          console.log(`[browsy] ${result.message}`);
          if (
            ['screenshot', 'eval', 'console', 'network', 'tabs', 'page-text', 'extract', 'doctor'].includes(name)
            && result.data !== undefined && result.data !== null
          ) {
            process.stdout.write(
              typeof result.data === 'string'
                ? result.data + '\n'
                : JSON.stringify(result.data, null, 2) + '\n',
            );
          }
        }
        if (!result.ok) process.exitCode = 1;
      } catch (e: any) {
        if (e instanceof CliUsageError) {
          console.error(`[browsy] ${e.message}`);
          process.exitCode = 2;
        } else if (isCdpError(e)) {
          console.error(`[browsy] CDP error: ${e.message}`);
          process.exitCode = 3;
        } else {
          console.error(`[browsy] ${name} failed: ${e.message}`);
          process.exitCode = 1;
        }
      } finally {
        // Session cache is process-scoped; close it so we don't leak sockets
        // when the CLI is a short-lived one-shot call.
        void closeAllSessions();
      }
    };

  program.command('navigate <url>').description('Navigate a tab to a URL').action(act('navigate', ['url']));
  program.command('open <url>').description('Navigate a tab to a URL (bring to front)').action(act('open', ['url']));
  program.command('screenshot')
    .description('Capture a screenshot (PNG base64 to stdout, or --output <file>)')
    .option('-o, --output <file>', 'Write to a file instead of stdout')
    .option('--full', 'Capture the full scrollable page')
    .option('--format <f>', 'png or jpeg', 'png')
    .option('--quality <q>', 'JPEG quality 0-100')
    .action(act('screenshot'));
  program.command('eval <expression>').description('Evaluate JS in the page').action(act('eval', ['expression']));
  program.command('wait <selector>')
    .description('Poll until a selector exists')
    .option('--timeout <ms>', 'Max wait in ms', (v) => Number(v))
    .option('--interval <ms>', 'Poll interval in ms', (v) => Number(v))
    .option('--fallback <selectors>', 'Comma-separated fallback selectors to try if primary fails')
    .action(act('wait', ['selector']));
  program.command('click <selector>')
    .description('Click the first matching element')
    .option('--trusted', 'Dispatch a renderer-trusted CDP mouse event (Input.dispatchMouseEvent)')
    .option('--fallback <selectors>', 'Comma-separated fallback selectors to try if primary fails')
    .action(act('click', ['selector']));
  program.command('fill <selector> <value>')
    .description('Set a form control value')
    .option('--trusted', 'Type via CDP Input.insertText after focusing the control')
    .option('--fallback <selectors>', 'Comma-separated fallback selectors to try if primary fails')
    .action(act('fill', ['selector', 'value']));
  program.command('extract <selector>')
    .description('Pull structured records from matching elements')
    .argument('[field...]', 'field spec: text | html | textContent | value | attr:<name>')
    .option('--limit <n>', 'Cap the number of records', (v) => Number(v))
    .option('--fallback <selectors>', 'Comma-separated fallback selectors to try if primary matches nothing')
    .action(act('extract', ['selector', 'fields']));
  program.command('run <script>')
    .description('Run a declarative browser automation script (JSON or YAML)')
    .action(act('run', ['script']));
  program.command('heal <selector>')
    .description('Diagnose why a selector failed and suggest alternatives from the page DOM')
    .option('--url <url>', 'URL to test against (defaults to current page)')
    .action(act('heal', ['selector']));
  program.command('intercept')
    .description('Enable network request interception for a URL pattern')
    .option('-p, --pattern <pattern>', 'URL pattern to intercept (supports * wildcards)')
    .action(act('intercept'));
  program.command('mock')
    .description('Mock a response for a URL pattern')
    .option('-p, --pattern <pattern>', 'URL pattern to mock (supports * wildcards)')
    .option('-s, --status <code>', 'HTTP status code', (v) => Number(v), 200)
    .option('-b, --body <body>', 'Response body', '{}')
    .option('--contenttype <type>', 'Content-Type header', 'application/json')
    .action(act('mock'));
  program.command('continue-request')
    .description('Continue, mock, or fail an intercepted request')
    .option('-i, --id <id>', 'Interception ID')
    .option('-a, --action <action>', 'Action: continue | mock | fail', 'continue')
    .option('--url <url>', 'Override request URL')
    .option('--method <method>', 'Override request method')
    .option('--postdata <data>', 'Override request body')
    .option('--headers <json>', 'Override headers as JSON')
    .option('--response <json>', 'Mock response as JSON: {status, headers, body, contentType}')
    .action(act('continue-request'));
  program.command('doctor')
    .description('Diagnostics: CDP endpoint, browser binary, memorius')
    .action(act('doctor'));
  program.command('ensure-browser')
    .description('Launch a dedicated CDP browser if the endpoint is down')
    .option('--port <n>', 'CDP debugging port', (v) => Number(v))
    .option('--binary <path>', 'Chrome/Chromium binary to launch')
    .option('--no-headless', 'Launch with a visible window')
    .action(act('ensure-browser'));
  program.command('stop-browser')
    .description('Stop a browser started by ensure-browser (via its pidfile)')
    .option('--port <n>', 'CDP debugging port', (v) => Number(v))
    .action(act('stop-browser'));
  program.command('page-text').description('Print the page\'s visible text').action(act('page-text'));
  program.command('console').description('Dump captured console entries').action(act('console'));
  program.command('network').description('Dump captured network requests').action(act('network'));
  program.command('tabs').description('List open tabs').option('--switch <id>', 'Switch the active target to this tab').action(act('tabs'));
  program.command('new-tab [url]').description('Open a new tab').action(act('new-tab', ['url']));
  program.command('close-tab <id>').description('Close a tab').action(act('close-tab', ['id']));
  program.command('switch-tab <id>').description('Switch the active target to a specific tab').action(act('switch-tab', ['id']));
  program.command('broadcast <selector> <action>').description('Run an action (click, fill, eval) across all tabs').argument('[value]', 'Value for fill action').option('--trusted', 'Use renderer-trusted CDP input events').option('-e, --expression <expr>', 'JavaScript expression for eval action').action(act('broadcast', ['selector', 'action', 'value']));
  program.command('cookies <subcommand>')
    .description('Manage cookies: get, set, delete, save, load')
    .argument('<subcommand>', 'get | set | delete | save | load')
    .option('--name <name>', 'Cookie name (for set/delete)')
    .option('--value <value>', 'Cookie value (for set)')
    .option('--domain <domain>', 'Cookie domain')
    .option('--path <path>', 'Cookie path')
    .option('--secure', 'Secure flag')
    .option('--httponly', 'HttpOnly flag')
    .option('--samesite <policy>', 'SameSite policy: Strict | Lax | None')
    .option('--expires <timestamp>', 'Expiration timestamp (Unix seconds)')
    .option('--urls <urls>', 'Comma-separated URLs to filter cookies (for get)')
    .option('--file <path>', 'File path (for save/load)')
    .action(act('cookies', ['subcommand', 'name', 'value', 'file']));
  program.command('visual-diff')
    .description('Compare current page screenshot against a baseline image')
    .requiredOption('-b, --baseline <path>', 'Baseline image path')
    .option('-c, --current <path>', 'Current image path (defaults to current page)')
    .option('-t, --threshold <n>', 'Diff threshold percentage (0-100)', (v) => Number(v), 1)
    .option('-o, --output <path>', 'Output diff image path')
    .action(act('visual-diff', ['baseline', 'current']));

  // MCP server — runs the stdio transport directly.
  program
    .command('mcp')
    .description('Run the browsy MCP stdio server')
    .action(async () => {
      await startMcpServer();
      // Keep the process alive for the stdio transport.
      process.stdin.resume();
      await new Promise(() => {}); // park forever
    });

  return program;
}

// Only run the CLI when executed directly (not when imported as a library).
function isDirectRun(): boolean {
  try {
    const entry = process.argv[1];
    return Boolean(entry) && /cli\.(ts|js)$/.test(entry);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  buildProgram().parse(process.argv);
}

export { buildProgram };
