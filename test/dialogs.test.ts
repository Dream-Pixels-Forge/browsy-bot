import { describe, it, expect, vi } from "vitest";
import {
  acceptDialog,
  dismissDialog,
  dialogText,
} from "../src/core/dialogs.js";

function makeDialogSession() {
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Page.enable") return {};
      if (method === "Page.handleJavaScriptDialog") {
        return { result: params?.promptText ?? undefined };
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

describe("dialogs", () => {
  it("acceptDialog handles the most recent dialog", async () => {
    const { session, conn } = makeDialogSession();
    let dialogHandler: any;
    vi.mocked(conn.on).mockImplementation((event: string, cb: any) => {
      if (event === "Page.javascriptDialogOpening") {
        dialogHandler = cb;
      }
    });

    // First call registers the Page.on handler but throws (no dialog yet).
    try {
      await acceptDialog(session);
    } catch {
      // expected — no dialog has arrived yet
    }

    // Simulate a dialog arriving via CDP event.
    dialogHandler({ params: { type: "alert", message: "hi" } });

    const out = await acceptDialog(session);
    expect(out).toBeUndefined();
    expect(conn.send).toHaveBeenCalledWith("Page.handleJavaScriptDialog", {
      accept: true,
      dialogIndex: 0,
      promptText: undefined,
    });
  });

  it("dismissDialog calls handleJavaScriptDialog with accept false", async () => {
    const { session, conn } = makeDialogSession();
    let dialogHandler: any;
    vi.mocked(conn.on).mockImplementation((event: string, cb: any) => {
      if (event === "Page.javascriptDialogOpening") {
        dialogHandler = cb;
      }
    });
    try {
      await dismissDialog(session);
    } catch {
      // expected
    }
    dialogHandler({ params: { type: "confirm", message: "Sure?" } });

    await dismissDialog(session);
    expect(conn.send).toHaveBeenCalledWith("Page.handleJavaScriptDialog", {
      accept: false,
      dialogIndex: 0,
    });
  });

  it("dialogText returns the message of the most recent dialog", async () => {
    const { session, conn } = makeDialogSession();
    let dialogHandler: any;
    vi.mocked(conn.on).mockImplementation((event: string, cb: any) => {
      if (event === "Page.javascriptDialogOpening") {
        dialogHandler = cb;
      }
    });
    try {
      await dialogText(session);
    } catch {
      // expected — no dialog yet
    }
    dialogHandler({ params: { type: "confirm", message: "Are you sure?" } });

    await expect(dialogText(session)).resolves.toBe("Are you sure?");
  });

  it("dialogText throws when no dialog has been opened", async () => {
    const { session } = makeDialogSession();
    await expect(dialogText(session)).rejects.toThrow(
      /no JavaScript dialog has been opened/,
    );
  });

  it("acceptDialog throws when no dialog has been opened", async () => {
    const { session } = makeDialogSession();
    await expect(acceptDialog(session)).rejects.toThrow(
      /no JavaScript dialog has been opened/,
    );
  });
});
