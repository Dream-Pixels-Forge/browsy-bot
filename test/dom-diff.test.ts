import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  captureDomSnapshot,
  diffDomSnapshots,
  saveDomBaseline,
  compareDom,
} from "../src/core/dom-diff.js";

vi.mock("../src/core/capture.js", () => ({
  ensureCapturesDir: vi.fn((): string => tmpBase),
}));

const tmpBase = path.join(os.tmpdir(), "browsy-dom-diff-test");
afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

function makeDomSession(domTree: any) {
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Runtime.enable") return {};
      if (method === "Runtime.evaluate") {
        return { result: { value: domTree } };
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

describe("captureDomSnapshot", () => {
  it("enables Runtime and returns the DOM snapshot tree", async () => {
    const domTree = {
      tag: "html",
      children: [
        { tag: "head", children: [] },
        {
          tag: "body",
          id: "main",
          class: ["container"],
          text: "Hello",
          children: [{ tag: "button", text: "Click" }],
        },
      ],
    };
    const { session, conn } = makeDomSession(domTree);
    const snapshot = await captureDomSnapshot(session);
    expect(conn.send).toHaveBeenCalledWith("Runtime.enable");
    expect(conn.send).toHaveBeenCalledWith("Runtime.evaluate", {
      expression: expect.any(String),
      returnByValue: true,
    });
    expect(snapshot.tag).toBe("html");
    expect(snapshot.children).toHaveLength(2);
    expect(snapshot.children[1]).toMatchObject({
      tag: "body",
      id: "main",
      class: ["container"],
      text: "Hello",
    });
  });
});

describe("diffDomSnapshots", () => {
  it("reports no diff for identical trees", () => {
    const a = { tag: "div", children: [{ tag: "span", text: "hi" }] };
    const b = { tag: "div", children: [{ tag: "span", text: "hi" }] };
    const result = diffDomSnapshots(a, b);
    expect(result.pass).toBe(true);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it("detects added elements", () => {
    const a = { tag: "div", children: [] };
    const b = { tag: "div", children: [{ tag: "p", text: "new" }] };
    const result = diffDomSnapshots(a, b);
    expect(result.pass).toBe(false);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({ tag: "p", path: "div > p" });
  });

  it("detects removed elements", () => {
    const a = { tag: "div", children: [{ tag: "p", text: "old" }] };
    const b = { tag: "div", children: [] };
    const result = diffDomSnapshots(a, b);
    expect(result.pass).toBe(false);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]).toMatchObject({ tag: "p" });
  });

  it("detects changed attributes", () => {
    const a = { tag: "button", class: ["primary"], text: "Save" };
    const b = { tag: "button", class: ["danger"], text: "Delete" };
    const result = diffDomSnapshots(a, b);
    expect(result.pass).toBe(false);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]).toMatchObject({ tag: "button" });
  });

  describe("saveDomBaseline", () => {
    it("captures DOM and writes baseline JSON file", async () => {
      const domTree = {
        tag: "html",
        children: [{ tag: "body", id: "main", children: [] }],
      };
      const { session } = makeDomSession(domTree);
      const filePath = await saveDomBaseline(session, "homepage");
      expect(filePath).toBe(path.join(tmpBase, "dom-baselines", "homepage.json"));
      expect(fs.existsSync(filePath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
      expect(content.tag).toBe("html");
      expect(content.children).toHaveLength(1);
    });
  });

  describe("compareDom", () => {
    it("passes when current DOM matches baseline", async () => {
      const domTree = {
        tag: "html",
        children: [{ tag: "body", id: "main", children: [] }],
      };
      const { session } = makeDomSession(domTree);
      // First save a baseline
      await saveDomBaseline(session, "compare-test");
      // Then compare (same snapshot) — should pass
      const result = await compareDom(session, "compare-test");
      expect(result.pass).toBe(true);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.changed).toEqual([]);
      expect(result.baselinePath).toBe(
        path.join(tmpBase, "dom-baselines", "compare-test.json")
      );
    });

    it("fails when current DOM differs from baseline", async () => {
      const domTree1 = {
        tag: "html",
        children: [{ tag: "body", id: "main", children: [] }],
      };
      const domTree2 = {
        tag: "html",
        children: [
          { tag: "body", id: "main", children: [] },
          { tag: "footer", children: [] },
        ],
      };
      const { session } = makeDomSession(domTree1);
      await saveDomBaseline(session, "diff-test");
      // Now change the session's domTree to domTree2
      vi.mocked(session.page).mockImplementation(async () => {
        const conn = {
          send: vi.fn(async (method: string) => {
            if (method === "Runtime.enable") return {};
            if (method === "Runtime.evaluate")
              return { result: { value: domTree2 } };
            return {};
          }),
          close: vi.fn(async () => {}),
          isConnected: () => true,
          getTargetId: () => "t1",
        };
        return conn;
      });
      const result = await compareDom(session, "diff-test");
      expect(result.pass).toBe(false);
      expect(result.added.length).toBeGreaterThan(0);
    });

    it("throws when no baseline exists", async () => {
      const { session } = makeDomSession({
        tag: "html",
        children: [],
      });
      await expect(compareDom(session, "nonexistent")).rejects.toThrow(
        /no baseline found/
      );
    });
  });
});
