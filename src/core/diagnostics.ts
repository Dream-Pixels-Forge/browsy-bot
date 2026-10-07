// Diagnostics — structured "is the environment ready to run browsy?" checks.
//
// `doctor` probes, without side effects:
//   - the CDP endpoint (HTTP /json/version + /json/list)
//   - the browser binary (PATH candidates + BROWSY_BROWSER_BINARY override)
//   - memorius availability (CLI on PATH)
//
// All probes are injectable so unit tests run with zero network / zero
// subprocess. The CLI and library surface is `doctor()`; adapters build
// on the individual probes.

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { CDPBrowserInfo, TargetListEntry } from './types.js';
import { listTargets } from './connection.js';

// --- probe results ----------------------------------------------------------

export interface EndpointProbe {
  reachable: boolean;
  version?: CDPBrowserInfo;
  targets: number;
  pageTargets: number;
  error?: string;
}

export interface BinaryProbe {
  found: boolean;
  path?: string;
  /** Which source resolved the binary. */
  source?: 'explicit' | 'env' | 'path';
}

export interface MemoriusProbe {
  available: boolean;
  /** Error text when the CLI exists but failed to answer. */
  error?: string;
}

export interface DoctorReport {
  endpoint: EndpointProbe;
  binary: BinaryProbe;
  memorius: MemoriusProbe;
  /** Human-readable, actionable next steps (empty when everything passes). */
  suggestions: string[];
  /** True only when the endpoint is reachable AND has at least one page target. */
  ready: boolean;
}

// --- injectable probes (the unit-test seam) --------------------------------

export interface DoctorProbes {
  getVersion(browserUrl: string): Promise<CDPBrowserInfo>;
  listTargets(browserUrl: string): Promise<TargetListEntry[]>;
  findBinary(explicit?: string): string | undefined;
  checkMemorius(): Promise<MemoriusProbe>;
}

// --- default probes ---------------------------------------------------------

function httpGetJson(url: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res: any) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`non-JSON response from ${url}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`timeout after ${timeoutMs}ms: ${url}`));
    });
    req.on('error', (e: Error) => reject(e));
  });
}

function toHttpUrl(browserUrl: string, suffix: string): string {
  let u = browserUrl.trim().replace(/\/$/, '');
  if (u.startsWith('ws://')) u = u.replace(/^ws/, 'http');
  else if (u.startsWith('wss://')) u = u.replace(/^wss/, 'https');
  else if (!/^https?:\/\//.test(u)) u = `http://${u}`;
  u = u.replace(/\/devtools\/.*/, '');
  return `${u}${suffix}`;
}

/** Probe the CDP endpoint's `/json/version`. Throws when unreachable. */
export async function probeVersion(browserUrl: string): Promise<CDPBrowserInfo> {
  return await httpGetJson(toHttpUrl(browserUrl, '/json/version'));
}

const BROWSER_BINARY_CANDIDATES: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/brave-browser',
  ],
};

function which(candidates: string[]): string | undefined {
  for (const bin of ['chrome', 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    // PATH lookup: `command -v` on POSIX, `where` on Windows.
    try {
      const cmd =
        process.platform === 'win32'
          ? `where ${bin}`
          : `command -v ${bin}`;
      const out = childProcess.execSync(cmd, {
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: process.platform === 'win32' ? undefined : 'sh',
      }).toString().trim();
      if (out) return out.split(/\r?\n/)[0];
    } catch {
      // not on PATH — try the next candidate
    }
  }
  for (const p of candidates) {
    try {
      fs.accessSync(p);
      return p;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

/** Find a usable Chrome/Chromium binary. Explicit > env > platform defaults. */
export function findBrowserBinary(explicit?: string): string | undefined {
  if (explicit) return explicit;
  const env = process.env.BROWSY_BROWSER_BINARY;
  if (env) return env;
  return which(BROWSER_BINARY_CANDIDATES[process.platform] ?? []);
}

/** Check whether the memorius CLI can answer. Injected shell keeps this testable. */
export async function checkMemorius(
  shell: (cmd: string) => Promise<{ ok: boolean; error?: string }> = async (cmd) => {
    return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      childProcess.exec(cmd, (err, _out, _err) => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true });
      });
    });
  },
): Promise<MemoriusProbe> {
  const res = await shell('memorius --version');
  if (res.ok) return { available: true };
  return { available: false, error: res.error ?? 'memorius not found or errored' };
}

function defaultProbes(): DoctorProbes {
  return {
    getVersion: probeVersion,
    listTargets: (url) => listTargets(url),
    findBinary: findBrowserBinary,
    checkMemorius,
  };
}

// --- doctor -----------------------------------------------------------------

export interface DoctorOptions {
  /** Override the browser binary lookup (explicit path). */
  binary?: string;
  /** Inject probes (unit tests). */
  probes?: Partial<DoctorProbes>;
}

/** Run all diagnostic probes and build an actionable report. */
export async function doctor(
  browserUrl: string,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const probes: DoctorProbes = { ...defaultProbes(), ...options.probes };

  // Endpoint probe (never throws — capture the failure in the report).
  let endpoint: EndpointProbe;
  try {
    const [version, targets] = await Promise.all([
      probes.getVersion(browserUrl),
      probes.listTargets(browserUrl),
    ]);
    const pageTargets = targets.filter((t) => t.type === 'page').length;
    endpoint = {
      reachable: true,
      version: version as CDPBrowserInfo,
      targets: targets.length,
      pageTargets,
    };
  } catch (e: any) {
    endpoint = { reachable: false, targets: 0, pageTargets: 0, error: e.message };
  }

  const binary = options.binary
    ? { found: true, path: options.binary, source: 'explicit' as const }
    : (() => {
        const p = probes.findBinary();
        return p
          ? { found: true, path: p, source: 'env' as const }
          : { found: false };
      })();

  const memorius = await probes.checkMemorius();

  const suggestions: string[] = [];
  if (!endpoint.reachable) {
    suggestions.push(
      `CDP endpoint ${browserUrl} is unreachable: ${endpoint.error}. ` +
        `Launch Chrome with: <chrome> --remote-debugging-port=9222 --headless --no-sandbox, ` +
        `or run "browsy ensure-browser" to start one for you.`,
    );
  } else if (endpoint.pageTargets === 0) {
    suggestions.push(
      `Endpoint is reachable but no page target is open. Open a tab: "browsy new-tab https://example.com".`,
    );
  }
  if (!binary.found) {
    suggestions.push(
      `No browser binary found on this machine. Set BROWSY_BROWSER_BINARY or pass --binary to ensure-browser.`,
    );
  }
  if (!memorius.available) {
    suggestions.push(
      `memorius not available — recall/remember will be no-ops (expected if you never installed it).`,
    );
  }

  return {
    endpoint,
    binary,
    memorius,
    suggestions,
    ready: endpoint.reachable && endpoint.pageTargets > 0,
  };
}
