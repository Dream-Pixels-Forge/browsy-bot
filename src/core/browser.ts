// Browser lifecycle — launch / stop / ensure a dedicated CDP browser.
//
// Closes the #1 onboarding gap: today every user hand-launches
// `chromium --remote-debugging-port=9222 --headless`. `ensureBrowser`
// makes that one call: probe the endpoint, and if it's down, spawn a
// Chrome/Chromium with a *dedicated* user-data-dir (never your real,
// logged-in profile) plus a CDP debugging port, wait for the endpoint
// to come up, and hand back a ready-to-use `ws://` URL.
//
// Security invariant (documented in README + Security section): the
// launched browser gets its own profile dir under the browsy state dir,
// so it can never touch your real Chrome auth state.
//
// All state is file-based (pidfile) so `stopBrowser` works in a separate
// process from `launchBrowser`. No platform-specific kill/ps fallbacks.

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findBrowserBinary, probeVersion } from './diagnostics.js';

export interface BrowserOptions {
  /** CDP debugging port. Default 9222. */
  port?: number;
  /** Host to bind to. Default "localhost" (loopback only — see Security). */
  host?: string;
  /** Explicit browser binary path. Overrides env/PATH lookup. */
  binary?: string;
  /** Launch headless. Default true. */
  headless?: boolean;
  /**
   * Pass `--no-sandbox`. Default true (needed for root/CI). Keep true in
   * untrusted environments; set false on a locked-down desktop where your
   * user is the only actor and the profile is dedicated.
   */
  noSandbox?: boolean;
  /** Dedicated profile dir. Default `<stateDir>/profile`. */
  userDataDir?: string;
  /** State dir for the pidfile. Default `<stateDir>` = `~/.browsy`. */
  stateDir?: string;
  /** Max ms to wait for the CDP endpoint to answer. Default 15000. */
  timeoutMs?: number;
  /** Extra CLI args appended verbatim (advanced). */
  extraArgs?: string[];
}

export interface LaunchedBrowser {
  pid: number;
  browserUrl: string;
  userDataDir: string;
  pidFile: string;
  binary: string;
  ready: boolean;
}

export interface StoppedBrowser {
  stopped: boolean;
  pid?: number;
  pidFile?: string;
  reason?: string;
}

const DEFAULT_PORT = 9222;
const DEFAULT_HOST = 'localhost';

function defaultStateDir(): string {
  return process.env.BROWSY_STATE_DIR ?? path.join(os.homedir(), '.browsy');
}

function pidFilePath(opts: BrowserOptions): string {
  const stateDir = opts.stateDir ?? defaultStateDir();
  const port = opts.port ?? DEFAULT_PORT;
  return path.join(stateDir, `browser-${port}.pid`);
}

/**
 * Pure, fully testable: build the Chrome/Chromium argv for a dedicated
 * CDP browser. No process is spawned here.
 */
export function buildBrowserArgs(opts: BrowserOptions = {}): string[] {
  const port = opts.port ?? DEFAULT_PORT;
  const headless = opts.headless ?? true;
  const noSandbox = opts.noSandbox ?? true;
  const args: string[] = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${opts.userDataDir ?? path.join(defaultStateDir(), 'profile')}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (headless) args.push('--headless=new');
  if (noSandbox) args.push('--no-sandbox');
  if (opts.extraArgs) args.push(...opts.extraArgs);
  return args;
}

/** Resolve the binary path for launch: explicit > env > platform lookup. */
export function resolveBrowserBinary(opts: BrowserOptions = {}): string | undefined {
  return findBrowserBinary(opts.binary);
}

function defaultUserDataDir(opts: BrowserOptions): string {
  return opts.userDataDir ?? path.join(opts.stateDir ?? defaultStateDir(), 'profile');
}

/** Poll the CDP endpoint until it answers, or throw on timeout. */
export async function waitForReady(
  browserUrl: string,
  timeoutMs: number,
  intervalMs = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await probeVersion(browserUrl);
      return;
    } catch {
      if (Date.now() >= deadline) {
        throw new Error(`browser did not become ready within ${timeoutMs}ms at ${browserUrl}`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

/**
 * Spawn a dedicated CDP browser, wait for the endpoint, and return the
 * ready handle. Detached so it outlives this process; the pidfile is what
 * `stopBrowser` uses later.
 */
export async function launchBrowser(opts: BrowserOptions = {}): Promise<LaunchedBrowser> {
  const binary = resolveBrowserBinary(opts);
  if (!binary) {
    throw new Error(
      'no browser binary found; set BROWSY_BROWSER_BINARY or pass --binary to ensure-browser',
    );
  }
  const stateDir = opts.stateDir ?? defaultStateDir();
  const userDataDir = defaultUserDataDir(opts);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = buildBrowserArgs(opts);
  const child = childProcess.spawn(binary, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const pidFile = pidFilePath(opts);
  fs.writeFileSync(pidFile, String(child.pid ?? ''), 'utf8');

  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port ?? DEFAULT_PORT;
  const browserUrl = `ws://${host}:${port}`;
  const timeoutMs = opts.timeoutMs ?? 15000;

  await waitForReady(browserUrl, timeoutMs);

  return {
    pid: child.pid ?? 0,
    browserUrl,
    userDataDir,
    pidFile,
    binary,
    ready: true,
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = liveness probe, no actual signal
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop a browser previously started by `launchBrowser`, via its pidfile.
 * Best-effort: reports whether a live process was signaled.
 */
export function stopBrowser(opts: BrowserOptions = {}): StoppedBrowser {
  const pidFile = pidFilePath(opts);
  let raw: string | undefined;
  try {
    raw = fs.readFileSync(pidFile, 'utf8').trim();
  } catch {
    return { stopped: false, reason: `no pidfile at ${pidFile}`, pidFile };
  }
  const pid = Number(raw);
  if (!Number.isFinite(pid) || pid <= 0) {
    fs.rmSync(pidFile, { force: true });
    return { stopped: false, reason: 'pidfile was empty or invalid', pidFile };
  }
  let killed = false;
  if (pidAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
      killed = true;
    } catch {
      killed = false;
    }
  }
  fs.rmSync(pidFile, { force: true });
  return {
    stopped: killed,
    pid,
    pidFile,
    reason: killed ? `sent SIGTERM to ${pid}` : `pid ${pid} not running (stale pidfile removed)`,
  };
}

export interface EnsuredBrowser {
  launched: boolean;
  browserUrl: string;
  /** Present only when this call actually launched a browser. */
  handle?: LaunchedBrowser;
  /** Reason the endpoint was already up (when launched=false). */
  note?: string;
}

/**
 * Probe the endpoint; if it's down, launch a dedicated browser and wait.
 * Idempotent: never double-launches when Chrome is already serving CDP.
 */
export async function ensureBrowser(opts: BrowserOptions = {}): Promise<EnsuredBrowser> {
  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port ?? DEFAULT_PORT;
  const browserUrl = `ws://${host}:${port}`;
  try {
    await probeVersion(browserUrl);
    return { launched: false, browserUrl, note: 'CDP endpoint already reachable' };
  } catch {
    // fall through to launch
  }
  const handle = await launchBrowser(opts);
  return { launched: true, browserUrl, handle };
}
