import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  remember,
  recall,
  context,
  isMemoriusAvailable,
  parseHits,
} from "../src/memorius.js";

// Minimal mock of the Bun shell shape. Each method records the last call
// and returns canned output. We never touch a real shell.
function makeShell(behaviour: {
  exitCode?: number;
  stdout?: string;
  throwOnCommand?: boolean;
}) {
  const calls: string[][] = [];
  const promise = {
    quiet() {
      return promise;
    },
    async text() {
      if (behaviour.throwOnCommand) {
        throw new Error("command failed");
      }
      return behaviour.stdout ?? "";
    },
    async *[Symbol.asyncIterator]() {},
    then(
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) {
      if (behaviour.throwOnCommand) {
        return Promise.reject(new Error("command failed")).then(undefined, onRejected);
      }
      return Promise.resolve({
        stdout: Buffer.from(behaviour.stdout ?? ""),
        stderr: Buffer.from(""),
        exitCode: behaviour.exitCode ?? 0,
      }).then(onFulfilled);
    },
  };

  const shell = (strings: TemplateStringsArray, ...exprs: unknown[]) => {
    // Reconstruct the command for assertion purposes.
    const cmd: string[] = [];
    strings.forEach((s, i) => {
      cmd.push(s);
      if (i < exprs.length) {
        const e = exprs[i];
        if (Array.isArray(e)) cmd.push(...(e as string[]));
        else cmd.push(String(e));
      }
    });
    calls.push(cmd.flatMap((c) => c.split(/\s+/).filter(Boolean)));
    return promise;
  };

  return { shell: shell as unknown as any, calls };
}

describe("memorius integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("isMemoriusAvailable returns true when command resolves", async () => {
    const { shell } = makeShell({ stdout: "/usr/local/bin/memorius\n" });
    const available = await isMemoriusAvailable(shell);
    expect(available).toBe(true);
  });

  it("isMemoriusAvailable returns false when command throws", async () => {
    const { shell } = makeShell({ throwOnCommand: true });
    const available = await isMemoriusAvailable(shell);
    expect(available).toBe(false);
  });

  it("remember returns true on success", async () => {
    const { shell, calls } = makeShell({});
    const ok = await remember(
      shell,
      { content: "Selector .save worked", shelf: "browsy", folder: "proj" },
      { vault: "main", shelf: "browsy" },
    );
    expect(ok).toBe(true);
    expect(calls[0]).toContain("memorius");
    expect(calls[0]).toContain("store");
    expect(calls[0]).toContain("Selector");
    expect(calls[0]).toContain("--shelf");
    expect(calls[0]).toContain("browsy");
  });

  it("remember returns false on failure without throwing", async () => {
    const { shell } = makeShell({ throwOnCommand: true });
    const ok = await remember(shell, { content: "x" });
    expect(ok).toBe(false);
  });

  it("recall returns parsed hits on success", async () => {
    const { shell } = makeShell({
      stdout: "1. .save selector worked (score: 0.92)\n2. /login flow (score: 0.81)\n",
    });
    const result = await recall(shell, "save button", { n: 5 });
    expect(result.available).toBe(true);
    expect(result.hits).toHaveLength(2);
    expect(result.hits![0].content).toBe(".save selector worked");
    expect(result.hits![0].score).toBe(0.92);
  });

  it("recall returns available=false when shell fails", async () => {
    const { shell } = makeShell({ throwOnCommand: true });
    const result = await recall(shell, "anything");
    expect(result.available).toBe(false);
    expect(result.hits).toBeUndefined();
  });

  it("context returns available=false on failure", async () => {
    const { shell } = makeShell({ throwOnCommand: true });
    const result = await context(shell, "auth flow");
    expect(result.available).toBe(false);
  });

  it("parseHits extracts numbered lines with optional scores", () => {
    const hits = parseHits("1. first (score: 0.9)\n2. second no score\n3. third (score: 0.55)");
    expect(hits).toHaveLength(3);
    expect(hits[0].content).toBe("first");
    expect(hits[0].score).toBe(0.9);
    expect(hits[2].score).toBe(0.55);
  });

  it("parseHits ignores non-numbered lines", () => {
    const hits = parseHits("Vault: main\n1. real hit\nsome other line");
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toBe("real hit");
  });
});