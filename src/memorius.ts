// Memorius integration — best-effort memory store/recall via the memorius CLI.
//
// The plugin runs under Bun, so we use Bun's shell (`$`) to call the
// `memorius` CLI. Every call is fire-and-forget with graceful fallback:
// if memorius is not installed or the vault is uninitialized, the helper
// resolves to a neutral value and never throws. This keeps browsy fully
// functional even when memorius is unavailable.
//
// See https://github.com/Dream-Pixels-Forge/memorius for the CLI.

// Minimal structural type for the subset of Bun's shell we use. `Shell`
// is not re-exported by @opencode-ai/plugin, so we define the shape we rely
// on to stay decoupled from internal types.
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
