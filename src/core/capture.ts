// Capture directory helpers for browsy-bot.
//
// When browsy works on a project, screenshots are stored in
// `<project>/dev-notes/browsy-captures/` (timestamped PNG files) rather
// than only returned as base64. Auto-save is opt-in: it only happens when
// the user grants permission via BROWSY_AUTOSAVE_CAPTURES=1|true|yes|on.
// Without that permission, screenshots return base64 only and never touch
// the disk unless an explicit outputPath is given. A project root is
// discovered by walking up from the working directory for a `.git`
// directory (preferred) or a `package.json`, skipping `node_modules` so an
// inner package is never mistaken for the root. When there is no project
// context, auto-capture is a no-op and callers fall back to base64 only.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** Truthy values that grant auto-save permission. */
const AUTOSAVE_PERMISSION = new Set(["1", "true", "yes", "on"]);

/** Permission gate: auto-save to dev-notes/browsy-captures only when the
 * user has opted in via BROWSY_AUTOSAVE_CAPTURES=1|true|yes|on. */
export function mayAutosave(): boolean {
  const v = process.env.BROWSY_AUTOSAVE_CAPTURES;
  return v !== undefined && AUTOSAVE_PERMISSION.has(v.trim().toLowerCase());
}

/** True when `dir` looks like a project root (`.git` or `package.json`). */
function isProjectRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, ".git")) ||
    fs.existsSync(path.join(dir, "package.json"))
  );
}

/** Walk up from `startDir` (default `process.cwd()`) looking for a project
 * marker: a `.git` directory (preferred) or a `package.json`. Stops at the
 * user's home directory. Returns the project root, or undefined. */
export function findProjectRoot(startDir: string = process.cwd()): string | undefined {
  let dir = path.resolve(startDir);
  const home = path.resolve(os.homedir());
  let fallback: string | undefined;
  for (;;) {
    const base = path.basename(dir);
    if (base !== "node_modules") {
      if (fs.existsSync(path.join(dir, ".git"))) return dir;
      // Walking inside→out, so keep the outermost package.json dir: that's
      // the real project root, not a nested package inside node_modules.
      if (fs.existsSync(path.join(dir, "package.json"))) fallback = dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir || parent === home) break;
    dir = parent;
  }
  return fallback;
}

/** The directory browsy uses to store captures for a project:
 * `<root>/dev-notes/browsy-captures`. Creates it (and missing parents)
 * when called. Returns undefined when there is no project context. */
export function ensureCapturesDir(projectRoot?: string): string | undefined {
  const root = projectRoot ?? findProjectRoot();
  if (!root || !isProjectRoot(root)) return undefined;
  const dir = path.join(root, "dev-notes", "browsy-captures");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Timestamped capture file name, e.g. `browsy-capture-20240101-123045-789.png`. */
export function captureFileName(format: "png" | "jpeg" = "png"): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${now.getMilliseconds()}`;
  return `browsy-capture-${stamp}.${format}`;
}

/** Write a base64 PNG/JPEG to `filePath`, creating parent dirs. Returns filePath.
 * Throws when the write fails — use this for explicit outputPath requests
 * where the user asked for a specific file and failure should surface. */
export function writeScreenshot(dataBase64: string, filePath: string): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(dataBase64, "base64"));
  return filePath;
}

/** Best-effort auto-save: tries to write the screenshot, never throws.
 * Returns { savedTo } on success or { error } when the directory is not
 * writable (e.g. read-only project). Callers should still return base64. */
export function tryAutoSave(
  dataBase64: string,
  dir: string,
  format: "png" | "jpeg",
): { savedTo?: string; error?: string } {
  try {
    const filePath = path.join(dir, captureFileName(format));
    return { savedTo: writeScreenshot(dataBase64, filePath) };
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : String(e),
    };
  }
}
