import { describe, it, expect } from "vitest";
import { retryableAction } from "../src/core/retry.js";

describe("retryableAction", () => {
  it("resolves on first attempt when action succeeds", async () => {
    const result = await retryableAction({} as any, async () => "success", {
      maxAttempts: 3,
    });
    expect(result).toBe("success");
  });

  it("retries when action throws, resolving on success", async () => {
    let attempt = 0;
    const result = await retryableAction(
      {} as any,
      async () => {
        attempt++;
        if (attempt < 2) throw new Error("transient");
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 1 },
    );
    expect(result).toBe("ok");
    expect(attempt).toBe(2);
  });

  it("throws after exhausting maxAttempts", async () => {
    await expect(
      retryableAction(
        {} as any,
        async () => {
          throw new Error("always fails");
        },
        { maxAttempts: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("always fails");
  });

  it("uses exponential backoff between attempts", async () => {
    const start = Date.now();
    await retryableAction(
      {} as any,
      async () => {
        throw new Error("fail");
      },
      { maxAttempts: 3, baseDelayMs: 5 },
    ).catch(() => {});
    const elapsed = Date.now() - start;
    // 2 delays: 5ms + 10ms = 15ms minimum (with timer resolution, >= 10ms)
    expect(elapsed).toBeGreaterThanOrEqual(10);
  });
});
