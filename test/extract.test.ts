// Unit tests for the structured-data extraction primitive. The CDP transport
// is faked; the assertions verify the exact shape of the in-page script
// (selector, fields, limit are all embedded) and the record[] result path.
import { describe, it, expect, vi } from "vitest";
import { extract } from "../src/core/extract.js";

function makeSession(records: Record<string, unknown>[]) {
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method !== "Runtime.evaluate") return {};
      // The extract script always evaluates to the record array via the
      // page; here we simulate "the page returned these records".
      return { result: { value: records } };
      // params?.expression is available for assertions below.
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

describe("extract", () => {
  it("returns the page's record array as-is", async () => {
    const records = [
      { text: "A", title: "a" },
      { text: "B", title: "b" },
    ];
    const { session } = makeSession(records);
    const out = await extract(session, ".item", ["text", "attr:title"]);
    expect(out).toEqual(records);
  });

  it("embeds the selector, fields, and limit in the in-page script", async () => {
    const { session, conn } = makeSession([]);
    await extract(session, "article.card", ["text", "value"], { limit: 5 });
    const call = conn.send.mock.calls.find((c) => c[0] === "Runtime.evaluate")!;
    const expr = String(call[1].expression);
    expect(expr).toContain('document.querySelectorAll("article.card")');
    expect(expr).toContain('["text","value"]');
    expect(expr).toContain("const limit = 5;");
    expect(call[1].returnByValue).toBe(true);
    expect(call[1].awaitPromise).toBe(true);
  });

  it("leaves limit null when omitted", async () => {
    const { session, conn } = makeSession([]);
    await extract(session, "li", ["text"]);
    const expr = String(
      conn.send.mock.calls.find((c) => c[0] === "Runtime.evaluate")![1].expression,
    );
    expect(expr).toContain("const limit = null;");
  });

  it("throws a typed error when the page JS rejects", async () => {
    const conn = {
      send: vi.fn(async () => ({
        exceptionDetails: {
          text: "Uncaught",
          exception: { description: "SyntaxError: bad selector" },
        },
      })),
      on: vi.fn(),
      close: vi.fn(async () => {}),
      isConnected: () => true,
      getTargetId: () => "t1",
    };
    const session: any = { browserUrl: "ws://x", targetId: "t1", page: vi.fn(async () => conn) };
    await expect(extract(session, ".x", ["text"])).rejects.toThrow(/bad selector/);
  });

  it("throws when the page returns a non-array", async () => {
    const conn = {
      send: vi.fn(async () => ({ result: { value: "not-an-array" } })),
      on: vi.fn(),
      close: vi.fn(async () => {}),
      isConnected: () => true,
      getTargetId: () => "t1",
    };
    const session: any = { browserUrl: "ws://x", targetId: "t1", page: vi.fn(async () => conn) };
    await expect(extract(session, ".x", ["text"])).rejects.toThrow(/expected an array/);
  });
});
