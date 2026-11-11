import { describe, it, expect, vi } from "vitest";
import { enterFrame, exitFrame } from "../src/core/frames.js";

function makeFramesSession() {
  const frames: Array<{ frameId: string; parentFrameId?: string; url: string }> = [];
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Page.getFrameTree") {
        return {
          frameTree: {
            frame: { frameId: "root", url: "https://example.com" },
            childFrames: frames.map((f) => ({
              frame: { frameId: f.frameId, parentFrameId: f.parentFrameId, url: f.url, backendNodeId: f.backendNodeId },
              childFrames: [],
            })),
          },
        };
      }
      if (method === "DOM.getFrameOwner") {
        return { backendNodeId: 1 };
      }
      if (method === "DOM.resolveNode") {
        if (params?.selector === "iframe#widget") {
          return { object: { objectId: "frame-node-1" } };
        }
        return { object: {} };
      }
      if (method === "Page.setFocusedFrame") return {};
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
  return { session, conn, frames };
}

describe("enterFrame", () => {
  it("resolves iframe and switches to its frame context", async () => {
    const { session, conn, frames } = makeFramesSession();
    frames.push({ frameId: "frame-1", parentFrameId: "root", url: "https://iframe.example.com", backendNodeId: 1 });
    const result = await enterFrame(session, "iframe#widget");
    expect(result).toBe("frame-1");
    expect(conn.send).toHaveBeenCalledWith("Page.getFrameTree", {});
    expect(conn.send).toHaveBeenCalledWith("Page.setFocusedFrame", { frameId: "frame-1" });
  });

  it("throws when frame is not found", async () => {
    const { session } = makeFramesSession();
    await expect(enterFrame(session, "iframe#missing")).rejects.toThrow(/not found/);
  });
});

describe("exitFrame", () => {
  it("returns to the parent frame context", async () => {
    const { session, conn } = makeFramesSession();
    await exitFrame(session);
    expect(conn.send).toHaveBeenCalledWith("Page.setFocusedFrame", { frameId: "root" });
  });
});
