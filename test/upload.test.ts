import { describe, it, expect, vi } from "vitest";
import { setFileInput } from "../src/core/upload.js";

function makeUploadSession() {
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "DOM.enable") return {};
      if (method === "DOM.resolveNode") {
        if (params?.selector === 'input[type="file"]') {
          return { object: { objectId: "obj-1" } };
        }
        return { object: {} };
      }
      if (method === "DOM.setFileInputFiles") {
        return {};
      }
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
  return { session, conn };
}

describe("setFileInput", () => {
  it("resolves the file input node and sets files via DOM.setFileInputFiles", async () => {
    const { session, conn } = makeUploadSession();
    await expect(
      setFileInput(session, 'input[type="file"]', ["document.pdf"]),
    ).resolves.toBeUndefined();
    expect(conn.send).toHaveBeenCalledWith("DOM.enable");
    expect(conn.send).toHaveBeenCalledWith("DOM.resolveNode", {
      selector: 'input[type="file"]',
    });
    expect(conn.send).toHaveBeenCalledWith("DOM.setFileInputFiles", {
      objectId: "obj-1",
      files: ["document.pdf"],
    });
  });

  it("throws when no file input matches the selector", async () => {
    const { session, conn } = makeUploadSession();
    // resolveNode returns empty object -> no nodeId
    vi.mocked(conn.send).mockImplementation(async (method: string, params?: any) => {
      if (method === "DOM.enable") return {};
      if (method === "DOM.resolveNode") return { object: {} };
      return {};
    });
    await expect(
      setFileInput(session, 'input[type="file"]', ["document.pdf"]),
    ).rejects.toThrow(/no file input found/);
  });
});
