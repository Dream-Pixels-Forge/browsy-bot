import { describe, it, expect, vi } from "vitest";
import {
  getCookies,
  setCookies,
  deleteCookies,
} from "../src/core/cookies.js";

function makeCookieSession() {
  const cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path?: string;
  }> = [];
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Network.enable") return {};
      if (method === "Network.getCookies") {
        return {
          cookies: cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path ?? "/",
            secure: false,
            httpOnly: false,
            session: true,
          })),
        };
      }
      if (method === "Network.setCookies") {
        for (const c of params?.cookies ?? []) {
          const existing = cookies.find((k) => k.name === c.name && k.domain === c.domain);
          if (existing) {
            existing.value = c.value;
            existing.path = c.path ?? "/";
          } else {
            cookies.push({ name: c.name, value: c.value, domain: c.domain, path: c.path ?? "/" });
          }
        }
        return {};
      }
      if (method === "Network.deleteCookies") {
        const idx = cookies.findIndex(
          (k) => k.name === params?.name && k.domain === params?.domain,
        );
        if (idx >= 0) cookies.splice(idx, 1);
        return {};
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
  return { session, conn, cookies };
}

describe("getCookies", () => {
  it("enables Network and returns cookies", async () => {
    const { session, conn, cookies } = makeCookieSession();
    cookies.push({ name: "session", value: "abc123", domain: "example.com" });
    const result = await getCookies(session);
    expect(conn.send).toHaveBeenCalledWith("Network.enable");
    expect(conn.send).toHaveBeenCalledWith("Network.getCookies", {});
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "session", value: "abc123", domain: "example.com" });
  });

  it("returns empty array when no cookies", async () => {
    const { session } = makeCookieSession();
    const result = await getCookies(session);
    expect(result).toEqual([]);
  });
});

describe("setCookies", () => {
  it("sets cookies via Network.setCookies", async () => {
    const { session, conn, cookies } = makeCookieSession();
    await setCookies(session, [
      { name: "token", value: "xyz", domain: "example.com", path: "/" },
    ]);
    expect(conn.send).toHaveBeenCalledWith("Network.setCookies", {
      cookies: [{ name: "token", value: "xyz", domain: "example.com", path: "/" }],
    });
    expect(cookies).toHaveLength(1);
    expect(cookies[0].value).toBe("xyz");
  });
});

describe("deleteCookies", () => {
  it("deletes a cookie via Network.deleteCookies", async () => {
    const { session, conn, cookies } = makeCookieSession();
    cookies.push({ name: "temp", value: "bye", domain: "example.com" });
    await deleteCookies(session, { name: "temp", domain: "example.com" });
    expect(conn.send).toHaveBeenCalledWith("Network.deleteCookies", {
      name: "temp",
      domain: "example.com",
    });
    expect(cookies).toHaveLength(0);
  });
});
