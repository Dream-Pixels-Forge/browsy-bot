import { describe, it, expect, vi } from "vitest";
import { getAccessibilityTree } from "../src/core/a11y.js";

function makeA11ySession() {
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Accessibility.enable") return {};
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            {
              nodeId: 1,
              role: { type: "RootWebArea", value: "RootWebArea" },
              name: { type: "string", value: "Example" },
            },
            {
              nodeId: 2,
              role: { type: "Button", value: "Button" },
              name: { type: "string", value: "Save" },
              value: { type: "string", value: "" },
            },
          ],
        };
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

describe("getAccessibilityTree", () => {
  it("enables Accessibility and returns filtered AX nodes", async () => {
    const { session, conn } = makeA11ySession();
    const tree = await getAccessibilityTree(session);
    expect(conn.send).toHaveBeenCalledWith("Accessibility.enable");
    expect(conn.send).toHaveBeenCalledWith("Accessibility.getFullAXTree", {});
    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({
      nodeId: 1,
      role: "RootWebArea",
      name: "Example",
    });
    expect(tree[1]).toMatchObject({
      nodeId: 2,
      role: "Button",
      name: "Save",
      value: "",
    });
  });
});
