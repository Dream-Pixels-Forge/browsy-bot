import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  setDownloadBehavior,
} from "../src/core/download.js";

const tmpBase = path.join(os.tmpdir(), "browsy-download-test");
afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

function makeDownloadSession() {
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Browser.setDownloadBehavior") return {};
      return {};
    }),
    on: vi.fn(),
    close: vi.fn(async () => {}),
    isConnected: () => true,
    getTargetId: () => "t1",
  };

  const session: any = {
    browserUrl: "ws://localhost:9222",
    targetId: "t1",
    page: vi.fn(async () => conn),
    browser: vi.fn(async () => conn),
  };
  return { session, conn };
}

describe("setDownloadBehavior", () => {
  it("calls Browser.setDownloadBehavior with behavior and dir", async () => {
    const { session, conn } = makeDownloadSession();
    await setDownloadBehavior(session, "allow", tmpBase);
    expect(conn.send).toHaveBeenCalledWith("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: tmpBase,
      eventsEnabled: true,
    });
  });

  it("supports deny behavior", async () => {
    const { session, conn } = makeDownloadSession();
    await setDownloadBehavior(session, "deny");
    expect(conn.send).toHaveBeenCalledWith("Browser.setDownloadBehavior", {
      behavior: "deny",
      downloadPath: undefined,
      eventsEnabled: true,
    });
  });
});
