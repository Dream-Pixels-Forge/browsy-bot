import { describe, it, expect, vi } from "vitest";
import { getStorage } from "../src/core/storage.js";

function makeStorageSession() {
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Runtime.enable") return {};
      if (method === "Runtime.evaluate") {
        // Simulate localStorage + sessionStorage for example.com
        const expression = String(params?.expression ?? "");
        if (expression.includes("localStorage")) {
          return {
            result: {
              value: JSON.stringify({
                localStorage: [["theme", "dark"], ["user", "alice"]],
                sessionStorage: [["tab", "dashboard"]],
              }),
            },
          };
        }
        return { result: { value: "{}" } };
      }
      return {};
    }),
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

describe("getStorage", () => {
  it("returns localStorage and sessionStorage for an origin", async () => {
    const { session, conn } = makeStorageSession();
    const result = await getStorage(session, "https://example.com");
    expect(conn.send).toHaveBeenCalledWith("Runtime.enable");
    expect(result.origin).toBe("https://example.com");
    expect(result.localStorage).toEqual({ theme: "dark", user: "alice" });
    expect(result.sessionStorage).toEqual({ tab: "dashboard" });
  });

  it("returns empty storage when none", async () => {
    const { session, conn } = makeStorageSession();
    vi.mocked(conn.send).mockImplementation(async (method: string) => {
      if (method === "Runtime.enable") return {};
      if (method === "Runtime.evaluate")
        return { result: { value: "{}" } };
      return {};
    });
    const result = await getStorage(session, "https://empty.com");
    expect(result.localStorage).toEqual({});
    expect(result.sessionStorage).toEqual({});
  });
});
