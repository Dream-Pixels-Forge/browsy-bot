// Unit tests for the browser-lifecycle layer. Pure / filesystem-only paths
// are asserted; no real browser is spawned. `stopBrowser` round-trips are
// exercised against a temp stateDir.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildBrowserArgs,
  stopBrowser,
  ensureBrowser,
  resolveBrowserBinary,
} from "../src/core/browser.js";
import { spawn } from "child_process";

// Mock diagnostics so the binary lookup is deterministic (no PATH/`which`).
vi.mock("../src/core/diagnostics.js", () => ({
  findBrowserBinary: vi.fn((explicit?: string) => explicit ?? "/usr/bin/chromium-mock"),
  probeVersion: vi.fn(),
}));

import { findBrowserBinary } from "../src/core/diagnostics.js";
import { probeVersion } from "../src/core/diagnostics.js";

describe("buildBrowserArgs (pure)", () => {
  it("defaults to headless + no-sandbox on port 9222 with a dedicated profile", () => {
    const args = buildBrowserArgs();
    expect(args).toContain("--remote-debugging-port=9222");
    expect(args).toContain("--headless=new");
    expect(args).toContain("--no-sandbox");
    expect(args).toContain("--no-first-run");
    expect(args).toContain("--no-default-browser-check");
    // dedicated user-data-dir always present, never the user's real profile
    expect(args.some((a) => a.startsWith("--user-data-dir="))).toBe(true);
  });

  it("honors explicit port / host-independent options", () => {
    const args = buildBrowserArgs({ port: 9333, headless: false, noSandbox: false });
    expect(args).toContain("--remote-debugging-port=9333");
    expect(args).not.toContain("--headless=new");
    expect(args).not.toContain("--no-sandbox");
  });

  it("appends extraArgs verbatim at the end", () => {
    const args = buildBrowserArgs({ extraArgs: ["--disable-gpu", "--mute-audio"] });
    expect(args.slice(-2)).toEqual(["--disable-gpu", "--mute-audio"]);
  });

  it("respects a custom userDataDir and stateDir for the profile", () => {
    const args = buildBrowserArgs({ userDataDir: "/tmp/browsy-test/profile" });
    expect(args).toContain("--user-data-dir=/tmp/browsy-test/profile");
  });
});

describe("resolveBrowserBinary precedence", () => {
  it("passes the explicit binary through to findBrowserBinary", () => {
    (findBrowserBinary as unknown as ReturnType<typeof vi.fn>).mockClear();
    const bin = resolveBrowserBinary({ binary: "/opt/custom/chrome" });
    // mock: findBrowserBinary(explicit) returns explicit when provided
    expect(bin).toBe("/opt/custom/chrome");
    expect(findBrowserBinary).toHaveBeenCalledWith("/opt/custom/chrome");
  });

  it("falls back to the env/PATH lookup when no explicit path is given", () => {
    (findBrowserBinary as unknown as ReturnType<typeof vi.fn>).mockClear();
    const bin = resolveBrowserBinary({});
    expect(bin).toBe("/usr/bin/chromium-mock");
    expect(findBrowserBinary).toHaveBeenCalledWith(undefined);
  });
});

describe("stopBrowser (pidfile round-trip)", () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "browsy-pid-"));
  });
  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("reports no-pidfile when nothing was launched", () => {
    const res = stopBrowser({ stateDir, port: 9222 });
    expect(res.stopped).toBe(false);
    expect(res.reason).toMatch(/no pidfile/);
  });

  it("removes a stale pidfile for a dead pid and reports it", () => {
    const pidFile = path.join(stateDir, "browser-9222.pid");
    // Use a pid that is almost certainly not ours: 1 is init and alive, so
    // pick 999999 (will ESRCH -> not alive).
    fs.writeFileSync(pidFile, "999999");
    const res = stopBrowser({ stateDir, port: 9222 });
    expect(res.stopped).toBe(false);
    expect(res.reason).toMatch(/not running|stale/);
    expect(fs.existsSync(pidFile)).toBe(false); // pidfile cleaned up
  });

  it("SIGTERMs a live pid it wrote itself and clears the pidfile", () => {
    // Spawn a real, long-lived child (a `sleep`) so the pid is alive.
    const { spawn } = require("child_process");
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    child.unref();
    const pidFile = path.join(stateDir, "browser-9222.pid");
    fs.writeFileSync(pidFile, String(child.pid));

    const res = stopBrowser({ stateDir, port: 9222 });
    expect(res.stopped).toBe(true);
    expect(res.pid).toBe(child.pid);
    expect(res.reason).toMatch(/SIGTERM/);
    expect(fs.existsSync(pidFile)).toBe(false);
  });
});

describe("ensureBrowser", () => {
  it("is a no-op launch when the endpoint is already up", async () => {
    (probeVersion as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      Browser: "HeadlessChrome/126.0.0.0",
      "Protocol-Version": "1.3",
    });
    const res = await ensureBrowser({ stateDir: os.tmpdir() });
    expect(res.launched).toBe(false);
    expect(res.note).toMatch(/already reachable/);
  });

  it("throws a clear error when the endpoint is down and no binary is found", async () => {
    (probeVersion as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ECONNREFUSED"),
    );
    (findBrowserBinary as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
    await expect(ensureBrowser({ stateDir: os.tmpdir() })).rejects.toThrow(
      /no browser binary/,
    );
  });
});
