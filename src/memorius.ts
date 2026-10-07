// Memorius integration — best-effort memory store/recall via the memorius CLI.
//
// The OpenCode plugin runs under Bun, so it uses Bun's shell (`$`) to call
// the `memorius` CLI. The MCP server and CLI run under Node, where there is
// no Bun shell — so we also expose `makeNodeShell()`, a `Shell` implementation
// backed by `child_process.exec`, with the same semantics: quiet(), text(),
// and throw-on-nonzero-exit so callers can fall back gracefully.
//
// Every call is fire-and-forget with graceful fallback: if memorius is not
// installed or the vault is uninitialized, the helpers resolve to a neutral
// value and never throw. This keeps browsy fully functional even when
// memorius is unavailable.
//
// See https://github.com/Dream-Pixels-Forge/memorius for the CLI.

import * as cp from "child_process";

// Detect Bun: Bun sets a BUN_VERSION env var and exposes globalThis.Bun.
function isBunRuntime(): boolean {
  return typeof process !== "undefined"
    && process.env.BUN_VERSION !== undefined
    && "Bun" in globalThis;
}

// Minimal structural type for the subset of Bun's shell we use. `Shell`
// is not re-exported by the OpenCode plugin package, so we define the
// shape we rely on to stay decoupled from internal types.
export interface Shell {
  (strings: TemplateStringsArray, ...expressions: Array<string | string[]>): ShellPromise;
}
export interface ShellPromise extends Promise<unknown> {
  quiet(): this;
  text(encoding?: BufferEncoding): Promise<string>;
  lines(): AsyncIterable<string>;
}

export type MemoriusOptions = {
  /** Vault name. Defaults to "main". */
  vault?: string;
  /** Default shelf for browsy learnings. */
  shelf?: string;
};

export type RememberInput = {
  content: string;
  shelf?: string;
  folder?: string;
  note?: string;
};

export type RecallResult = {
  available: boolean;
  raw: string;
  /** Parsed search hits when memorius returned parseable JSON. */
  hits?: Array<{ content: string; score?: number }>;
};

const DEFAULT_VAULT = "main";
const DEFAULT_SHELF = "browsy";

function cmd(parts: Array<string | false | null | undefined>): string[] {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/** Detect whether the `memorius` CLI is on PATH. */
export async function isMemoriusAvailable($: Shell): Promise<boolean> {
  try {
    const out = await $`command -v memorius`.quiet().text();
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Store a memory in the vault. Resolves to true on success, false if
 * memorius is unavailable or the store failed. Never throws.
 */
export async function remember(
  $: Shell,
  input: RememberInput,
  options: MemoriusOptions = {},
): Promise<boolean> {
  const vault = options.vault ?? DEFAULT_VAULT;
  const shelf = input.shelf ?? options.shelf ?? DEFAULT_SHELF;
  const args = cmd([
    "memorius",
    "store",
    input.content,
    "--vault",
    vault,
    "--shelf",
    shelf,
    input.folder ? "--folder" : null,
    input.folder ?? null,
    input.note ? "--note" : null,
    input.note ?? null,
  ]);

  try {
    await $`${args}`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Semantic search across the vault. Returns parsed hits when memorius
 * responds, or an empty result when memorius is unavailable. Never throws.
 */
export async function recall(
  $: Shell,
  query: string,
  options: MemoriusOptions & { n?: number } = {},
): Promise<RecallResult> {
  const vault = options.vault ?? DEFAULT_VAULT;
  const n = options.n ?? 5;
  const args = cmd([
    "memorius",
    "search",
    query,
    "--vault",
    vault,
    "--n",
    String(n),
  ]);

  try {
    const raw = await $`${args}`.quiet().text();
    return { available: true, raw, hits: parseHits(raw) };
  } catch {
    return { available: false, raw: "" };
  }
}

/** Inject context for a topic via `memorius context`. Never throws. */
export async function context(
  $: Shell,
  topic: string,
  options: MemoriusOptions & { max?: number } = {},
): Promise<RecallResult> {
  const vault = options.vault ?? DEFAULT_VAULT;
  const max = options.max ?? 5;
  const args = cmd([
    "memorius",
    "context",
    topic,
    "--vault",
    vault,
    "--max",
    String(max),
  ]);

  try {
    const raw = await $`${args}`.quiet().text();
    return { available: true, raw, hits: parseHits(raw) };
  } catch {
    return { available: false, raw: "" };
  }
}

/**
 * Best-effort parse of memorius search/context text output into structured
 * hits. memorius prints lines like `1. <content> (score: 0.92)`; we extract
 * those and leave the rest as raw text.
 */
export function parseHits(raw: string): Array<{ content: string; score?: number }> {
  const hits: Array<{ content: string; score?: number }> = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*\d+\.\s+(.+?)\s*(?:\(score:\s*([\d.]+)\))?\s*$/);
    if (m) {
      hits.push({
        content: m[1],
        score: m[2] ? Number(m[2]) : undefined,
      });
    }
  }
  return hits;
}

// --- Node-compatible shell -----------------------------------------------
//
// The Shell interface above models Bun's `$` template-tag shell. Under Node
// (MCP server, CLI) there is no `$`, so we provide an equivalent built on
// child_process. POSIX-only: it shells out via `sh -c`, which is where the
// memorius CLI lives anyway (pipx/python or npm).

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Shell-escape a single argument for `sh -c`. Arguments that are safe
 * (no whitespace / shell metacharacters) pass through; the rest are
 * single-quoted with embedded quotes escaped.
 */
export function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_\-./=:@%+,]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Expand array/template expressions into a `sh -c` command line. */
function toCommandLine(strings: TemplateStringsArray, expressions: Array<string | string[]>): string {
  const parts: string[] = [];
  strings.forEach((s, i) => {
    if (s) parts.push(s);
    if (i < expressions.length) {
      const e = expressions[i];
      if (Array.isArray(e)) {
        // Array = one argv element per entry (Bun shell semantics).
        for (const el of e) parts.push(shellQuote(el));
      } else {
        parts.push(String(e));
      }
    }
  });
  // Collapse: leading/trailing template text and quoted args are separated
  // by the original whitespace the caller put in the literals. We re-join
  // with spaces — good enough for the memorius call shapes we use.
  return parts.join(" ").trim();
}

class NodeShellPromise extends Promise<ShellResult> implements ShellPromise {
  private readonly inner: Promise<ShellResult>;

  constructor(inner: Promise<ShellResult>) {
    super(() => {}); // placeholder executor; the real result is `inner`
    this.inner = inner;
  }

  quiet(): this {
    return this;
  }

  async text(): Promise<string> {
    const result = await this.inner;
    return result.stdout;
  }

  async *lines(): AsyncIterable<string> {
    const result = await this.inner;
    for (const line of result.stdout.split(/\r?\n/)) {
      yield line;
    }
  }

  // Thenable: awaitable, resolving to the ShellResult.
  then<TResult1 = ShellResult, TResult2 = never>(
    onFulfilled?: ((value: ShellResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.inner.then(onFulfilled ?? undefined, onRejected ?? undefined);
  }
}

function runShellCommand(commandLine: string): NodeShellPromise {
  const p = new Promise<ShellResult>((resolve, reject) => {
    cp.exec(commandLine, { timeout: 30_000, encoding: "utf8" as const }, (err, stdout, stderr) => {
      if (err) {
        // Match Bun: a non-zero exit (or spawn failure) rejects the promise.
        const code = (err as { code?: number | string | null }).code;
        const out = String(stdout ?? "");
        const errOut = String(stderr ?? "");
        reject(
          Object.assign(
            new Error(`command failed (exit ${code ?? 1}): ${commandLine}\n${errOut}`),
            { code, stdout: out, stderr: errOut },
          ),
        );
      } else {
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), exitCode: 0 });
      }
    });
  });
  return new NodeShellPromise(p);
}

/**
 * Build a Node-backed Shell (Bun-compatible template-tag shape) for
 * environments without Bun. Under Node the OpenCode plugin's `input.$`
 * is unavailable, so MCP/CLI adapters call this and pass the result to
 * `remember` / `recall` / `context`.
 */
export function makeNodeShell(): Shell {
  const shell = (strings: TemplateStringsArray, ...expressions: Array<string | string[]>): ShellPromise =>
    runShellCommand(toCommandLine(strings, expressions));
  return shell;
}

/**
 * Pick the right shell: use the Bun shell when running under Bun
 * (OpenCode), fall back to the Node shell otherwise. Pass an explicit
 * shell (e.g. the OpenCode plugin's `input.$`) to override detection.
 */
export function getMemoriusShell(explicit?: Shell): Shell {
  if (explicit) return explicit;
  if (isBunRuntime()) {
    const bun = globalThis as { $?: unknown };
    if (typeof bun.$ === "function") {
      return bun.$ as Shell;
    }
  }
  return makeNodeShell();
}
