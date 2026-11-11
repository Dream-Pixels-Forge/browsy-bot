// Visual regression — capture baselines and diff screenshots over CDP.
//
// Flow:
//   1. captureBaseline(session, name): full-page screenshot -> baselines/<name>.png
//   2. compareScreenshot(session, name): full-page screenshot -> diffs/<name>.png,
//      pixel-compare against baselines/<name>.png, return pass/fail + stats
//
// PNG decode is minimal (color types 2/6, bit depth 8, filter 0, no interlace)
// which covers what Chrome emits for Page.captureScreenshot. No extra deps:
// zlib is built into Node.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import {
  fullPageScreenshot,
} from "./actions.js";
import { ensureCapturesDir } from "./capture.js";
import type { Session } from "./session.js";

interface VisualOptions {
  baselineDir?: string;
  diffDir?: string;
  /** Max fraction of differing pixels (0..1) to still pass. Default 0. */
  threshold?: number;
}

interface VisualResult {
  pass: boolean;
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  baselinePath: string;
  diffPath: string;
}

/** ---------- PNG decode (minimal) ---------- */

function readUInt32BE(buf: Buffer, off: number): number {
  return (
    (buf[off] << 24) |
    (buf[off + 1] << 16) |
    (buf[off + 2] << 8) |
    buf[off + 3]
  );
}

interface PngInfo {
  width: number;
  height: number;
  rgba: Buffer; // width * height * 4
}

export function decodePng(data: Buffer): PngInfo {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG file");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let idatChunks: Buffer[] = [];

  let offset = 8;
  while (offset < data.length) {
    const length = readUInt32BE(data, offset);
    const type = data.subarray(offset + 4, offset + 8).toString("latin1");
    const chunkData = data.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = readUInt32BE(chunkData, 0);
      height = readUInt32BE(chunkData, 4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(chunkData));
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length; // length + type + data + CRC(4)
  }

  if (bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth: ${bitDepth}`);
  }
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`unsupported PNG color type: ${colorType}`);
  }

  const compressed = Buffer.concat(idatChunks);
  const raw = zlib.inflateSync(compressed);

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const rgba = Buffer.alloc(width * height * 4);

  // Paeth predictor for filter 4
  function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  let ri = 0;
  let oi = 0;
  const prevLine = Buffer.alloc(stride); // raw bytes of previous scanline
  for (let y = 0; y < height; y++) {
    const filter = raw[oi];
    oi += 1;
    const lineRaw = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const f = raw[oi];
      oi += 1;
      const left = i >= bytesPerPixel ? lineRaw[i - bytesPerPixel] : 0;
      const up = prevLine[i];
      const upLeft = i >= bytesPerPixel ? prevLine[i - bytesPerPixel] : 0;
      let val: number;
      switch (filter) {
        case 0: // None
          val = f;
          break;
        case 1: // Sub
          val = (f + left) & 0xff;
          break;
        case 2: // Up
          val = (f + up) & 0xff;
          break;
        case 3: // Average
          val = (f + ((left + up) >> 1)) & 0xff;
          break;
        case 4: // Paeth
          val = (f + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`unsupported PNG filter: ${filter}`);
      }
      lineRaw[i] = val;
    }
    // Copy lineRaw (RGB or RGBA) into rgba (always RGBA)
    if (colorType === 6) {
      lineRaw.copy(rgba.subarray(ri, ri + stride));
    } else {
      // colorType 2 (RGB): expand to RGBA
      for (let x = 0; x < width; x++) {
        const si = x * 3;
        const di = x * 4;
        rgba[ri + di] = lineRaw[si];
        rgba[ri + di + 1] = lineRaw[si + 1];
        rgba[ri + di + 2] = lineRaw[si + 2];
        rgba[ri + di + 3] = 255;
      }
    }
    ri += width * 4;
    lineRaw.copy(prevLine);
  }

  return { width, height, rgba };
}

/** ---------- public API ---------- */

function defaultDirs(kind: "baselines" | "diffs"): string {
  const base = ensureCapturesDir();
  return base ? path.join(base, kind) : path.join(os.tmpdir(), "browsy-captures", kind);
}

export async function captureBaseline(
  session: Session,
  name: string,
  options: VisualOptions = {},
): Promise<string> {
  const dir = options.baselineDir ?? defaultDirs("baselines");
  fs.mkdirSync(dir, { recursive: true });
  const data = await fullPageScreenshot(session);
  const filePath = path.join(dir, `${name}.png`);
  fs.writeFileSync(filePath, Buffer.from(data, "base64"));
  return filePath;
}

/** Capture a full-page screenshot, diff it against the baseline, return pass/fail. */
export async function compareScreenshot(
  session: Session,
  name: string,
  options: VisualOptions = {},
): Promise<VisualResult> {
  const baselineDir = options.baselineDir ?? defaultDirs("baselines");
  const diffDir = options.diffDir ?? defaultDirs("diffs");
  const threshold = options.threshold ?? 0;
  fs.mkdirSync(diffDir, { recursive: true });

  const baselinePath = path.join(baselineDir, `${name}.png`);
  const diffPath = path.join(diffDir, `${name}.png`);

  const data = await fullPageScreenshot(session);
  fs.writeFileSync(diffPath, Buffer.from(data, "base64"));

  let diffPixels = 0;
  let totalPixels = 0;
  let pass = false;

  try {
    const baselineBuf = fs.readFileSync(baselinePath);
    const currentBuf = fs.readFileSync(diffPath);
    const a = decodePng(baselineBuf);
    const b = decodePng(currentBuf);

    if (a.width !== b.width || a.height !== b.height) {
      // Different dimensions: treat every pixel as differing.
      diffPixels = Math.max(a.width * a.height, b.width * b.height);
      totalPixels = diffPixels;
      pass = false;
    } else {
      totalPixels = a.width * a.height;
      for (let i = 0; i < a.rgba.length; i += 4) {
        if (
          a.rgba[i] !== b.rgba[i] ||
          a.rgba[i + 1] !== b.rgba[i + 1] ||
          a.rgba[i + 2] !== b.rgba[i + 2] ||
          a.rgba[i + 3] !== b.rgba[i + 3]
        ) {
          diffPixels++;
        }
      }
      pass = diffPixels / totalPixels <= threshold;
    }
  } catch {
    // If we can't decode (e.g. missing baseline), fail safe.
    diffPixels = 0;
    totalPixels = 0;
    pass = false;
  }

  return { pass, diffPixels, totalPixels, diffRatio: totalPixels ? diffPixels / totalPixels : 1, baselinePath, diffPath };
}
