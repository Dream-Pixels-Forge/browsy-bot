import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { recordSession, replaySession } from "../src/core/record.js";

const tmpBase = path.join(os.tmpdir(), "browsy-record-test");
afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

function makeRecordSession() {
  const messages: Array<{ method: string; params?: any }> = [];
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      messages.push({ method, params });
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
  };
  return { session, conn, messages };
}

describe("recordSession", () => {
  it("records messages to NDJSON", async () => {
    const { session, conn } = makeRecordSession();
    const filePath = path.join(tmpBase, "session.ndjson");
    const { stopRecording } = await recordSession(session, filePath);

    // Simulate a message
    await conn.send("Page.navigate", { url: "https://example.com" });

    // Stop recording
    stopRecording();

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const first = JSON.parse(lines[0]);
    expect(first.type).toBe("message");
    expect(first.method).toBe("Page.navigate");
    expect(first.params).toEqual({ url: "https://example.com" });
  });

  it("restores original send after stopRecording", async () => {
    const { session, conn } = makeRecordSession();
    const filePath = path.join(tmpBase, "restore.ndjson");
    const { stopRecording } = await recordSession(session, filePath);
    stopRecording();
    // After stop, conn.send should be the original mock again
    await conn.send("Page.navigate", { url: "https://example.org" });
    expect(conn.send).toHaveBeenLastCalledWith("Page.navigate", {
      url: "https://example.org",
    });
  });
});

describe("replaySession", () => {
  it("replays recorded messages", async () => {
    const filePath = path.join(tmpBase, "replay.ndjson");
    fs.mkdirSync(tmpBase, { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        type: "message",
        method: "Page.navigate",
        params: { url: "https://example.com" },
        result: { frameId: "f1" },
        timestamp: 1,
      }) + "\n"
    );
    const conn = await replaySession(filePath);
    const result = await conn.send("Page.navigate", { url: "https://example.com" });
    expect(result).toEqual({ frameId: "f1" });
    expect(conn.isConnected()).toBe(true);
  });
});
