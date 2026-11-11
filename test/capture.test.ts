import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  findProjectRoot,
  ensureCapturesDir,
  captureFileName,
  writeScreenshot,
  mayAutosave,
  tryAutoSave,
} from "../src/core/capture.js";

const tmpBase = path.join(os.tmpdir(), "browsy-capture-test");
let created: string[] = [];
const savedEnv = process.env.BROWSY_AUTOSAVE_CAPTURES;

afterEach(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
  created = [];
  // Also scrub any captures dir the tests produced inside project roots.
  fs.rmSync(tmpBase, { recursive: true, force: true });
  // Restore the env var so tests don't leak permission state.
  if (savedEnv === undefined) delete process.env.BROWSY_AUTOSAVE_CAPTURES;
  else process.env.BROWSY_AUTOSAVE_CAPTURES = savedEnv;
});

function mkDir(...parts: string[]): string {
  const dir = path.join(tmpBase, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  created.push(tmpBase);
  return dir;
}

describe("findProjectRoot", () => {
  it("returns the dir that contains a package.json", () => {
    const root = mkDir("proj");
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"x"}');
    expect(findProjectRoot(root)).toBe(root);
  });

  it("prefers a .git directory over package.json", () => {
    const root = mkDir("proj");
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"x"}');
    expect(findProjectRoot(root)).toBe(root);
  });

  it("skips node_modules so an inner package is not mistaken for the root", () => {
    const root = mkDir("real");
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"real"}');
    const mod = path.join(root, "node_modules", "dep");
    fs.mkdirSync(mod, { recursive: true });
    fs.writeFileSync(path.join(mod, "package.json"), '{"name":"dep"}');
    expect(findProjectRoot(mod)).toBe(root);
  });

  it("returns undefined when no marker is found", () => {
    expect(findProjectRoot(mkDir("empty"))).toBeUndefined();
  });
});

describe("ensureCapturesDir", () => {
  it("returns undefined with no project context", () => {
    expect(ensureCapturesDir(mkDir("empty"))).toBeUndefined();
  });

  it("creates <root>/dev-notes/browsy-captures and returns it", () => {
    const root = mkDir("proj");
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"x"}');
    const dir = ensureCapturesDir(root);
    expect(dir).toBe(path.join(root, "dev-notes", "browsy-captures"));
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });
});

describe("captureFileName", () => {
  it("produces a timestamped png name", () => {
    expect(captureFileName("png")).toMatch(
      /^browsy-capture-\d{8}-\d{6}-\d{1,3}\.png$/,
    );
  });

  it("produces a timestamped jpeg name", () => {
    expect(captureFileName("jpeg")).toMatch(
      /^browsy-capture-\d{8}-\d{6}-\d{1,3}\.jpeg$/,
    );
  });
});

describe("writeScreenshot", () => {
  it("writes the base64 payload to the file and returns the path", () => {
    const file = path.join(mkDir("proj"), "cap.png");
    const data = Buffer.from("hello capture").toString("base64");
    const out = writeScreenshot(data, file);
    expect(out).toBe(file);
    expect(fs.readFileSync(file)).toEqual(Buffer.from("hello capture"));
  });
});

describe("mayAutosave", () => {
  it("is false by default (no permission)", () => {
    delete process.env.BROWSY_AUTOSAVE_CAPTURES;
    expect(mayAutosave()).toBe(false);
  });

  it("is true for accepted permission values", () => {
    for (const v of ["1", "true", "True", "YES", "on"]) {
      process.env.BROWSY_AUTOSAVE_CAPTURES = v;
      expect(mayAutosave()).toBe(true, `expected ${v} to grant permission`);
    }
  });

  it("is false for rejected values", () => {
    for (const v of ["0", "false", "no", "off", "maybe", ""]) {
      process.env.BROWSY_AUTOSAVE_CAPTURES = v;
      expect(mayAutosave()).toBe(false, `expected ${v} to deny permission`);
    }
  });
});

describe("tryAutoSave", () => {
  it("writes to the captures dir and returns savedTo without throwing", () => {
    const dir = mkDir("proj", "dev-notes", "browsy-captures");
    const data = Buffer.from("auto capture").toString("base64");
    const result = tryAutoSave(data, dir, "png");
    expect(result.error).toBeUndefined();
    expect(result.savedTo).toBe(path.join(dir, result.savedTo!.split("/").pop()!));
    expect(fs.existsSync(result.savedTo!)).toBe(true);
    expect(fs.readFileSync(result.savedTo!)).toEqual(Buffer.from("auto capture"));
  });

  it("returns an error instead of throwing when the dir is not writable", () => {
    // Use a file path as the dir so mkdirSync/write fails.
    const blockingFile = path.join(mkDir("proj"), "notadir");
    fs.writeFileSync(blockingFile, "im a file");
    const data = Buffer.from("x").toString("base64");
    const result = tryAutoSave(data, blockingFile, "png");
    expect(result.savedTo).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
  });
});
