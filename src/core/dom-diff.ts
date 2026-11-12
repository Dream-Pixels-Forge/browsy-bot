// DOM-structure visual diff — compare two page snapshots structurally
// (tag, id, class, attributes, text, child count, visibility, rect) rather
// than pixel-by-pixel. More robust than pixel diff for dynamic content,
// animations, anti-aliasing, and timestamps.
//
// captureDomSnapshot(session): runs an in-page script via
// Runtime.evaluate to serialize the DOM tree, returns the snapshot.
// diffDomSnapshots(a, b): pure function comparing two snapshots, returns
// { pass, added, removed, changed } with element paths.

import type { CDPConnection } from './connection.js';
import * as fs from 'fs';
import * as path from 'path';
import type { Session } from './session.js';
import { ensureCapturesDir } from './capture.js';

type Conn = CDPConnection;

interface DomNode {
  tag: string;
  id?: string;
  class?: string[];
  attributes?: Record<string, string>;
  text?: string;
  visible?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  children: DomNode[];
}

export interface DomSnapshot {
  tag: string;
  url?: string;
  title?: string;
  children: DomNode[];
}

export interface DiffEntry {
  path: string;
  tag: string;
  id?: string;
  class?: string[];
  text?: string;
  detail?: string;
}

export interface DiffResult {
  pass: boolean;
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffEntry[];
}

/** In-page script: serialize the DOM tree starting from document.documentElement. */
const SNAPSHOT_SCRIPT = `
(() => {
  function serialize(el) {
    if (!el || el.nodeType !== 1) return null;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const node = {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      class: el.className ? el.className.split(/\s+/).filter(Boolean) : undefined,
      attributes: {},
      text: el.textContent ? el.textContent.trim().slice(0, 200) : undefined,
      visible: style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      children: [],
    };
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      node.attributes[attr.name] = attr.value;
    }
    for (let i = 0; i < el.children.length; i++) {
      const child = serialize(el.children[i]);
      if (child) node.children.push(child);
    }
    return node;
  }
  return { tag: 'html', url: location.href, title: document.title, children: Array.from(document.documentElement.children).map(serialize).filter(Boolean) };
})();
`;

/** Capture the current page DOM as a serializable snapshot. */
export async function captureDomSnapshot(session: Session): Promise<DomSnapshot> {
  const conn = await session.page();
  await conn.send('Runtime.enable');
  const result = await conn.send<{ result?: { value?: any } }>('Runtime.evaluate', {
    expression: SNAPSHOT_SCRIPT,
    returnByValue: true,
  });
  return result?.result?.value ?? { tag: 'html', children: [] };
}

/** Build a CSS-like path for a node (best-effort, using id/class/tag). */
function nodePath(node: DomNode, ancestors: string[] = []): string {
  let part = node.tag;
  if (node.id) part += `#${node.id}`;
  else if (node.class && node.class.length) part += `.${node.class.join('.')}`;
  const full = [...ancestors, part].join(' > ');
  return full;
}

/** Compare two DOM nodes, returning a changed entry or null. */
function diffNode(a: DomNode, b: DomNode, path: string): DiffEntry | null {
  const changes: string[] = [];
  if (a.tag !== b.tag) changes.push(`tag: ${a.tag} → ${b.tag}`);
  if ((a.id ?? '') !== (b.id ?? '')) changes.push(`id: ${a.id ?? '(none)'} → ${b.id ?? '(none)'}`);
  const aClass = (a.class ?? []).join(',');
  const bClass = (b.class ?? []).join(',');
  if (aClass !== bClass) changes.push(`class: ${aClass} → ${bClass}`);
  const aText = (a.text ?? '').slice(0, 80);
  const bText = (b.text ?? '').slice(0, 80);
  if (aText !== bText) changes.push(`text: ${aText} → ${bText}`);
  if (changes.length === 0) return null;
  return { path, tag: b.tag, id: b.id, class: b.class, text: b.text, detail: changes.join('; ') };
}

/** Compare two snapshots, returning added/removed/changed elements. */
export function diffDomSnapshots(a: DomSnapshot, b: DomSnapshot): DiffResult {
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: DiffEntry[] = [];

  function compare(na: DomNode | undefined, nb: DomNode | undefined, ancestors: string[]) {
    // Handle missing nodes on either side.
    if (!na || !nb) {
      if (!na && nb) {
        added.push({ path: nodePath(nb, ancestors), tag: nb.tag, id: nb.id, class: nb.class, text: nb.text, detail: 'added' });
      } else if (na && !nb) {
        removed.push({ path: nodePath(na, ancestors), tag: na.tag, id: na.id, class: na.class, text: na.text, detail: 'removed' });
      }
      return;
    }
    // Both defined from here on.
    const path = nodePath(na, ancestors);
    const change = diffNode(na, nb, path);
    if (change) changed.push(change);
    const aChildren = na.children ?? [];
    const bChildren = nb.children ?? [];
    const len = Math.max(aChildren.length, bChildren.length);
    for (let i = 0; i < len; i++) {
      compare(aChildren[i], bChildren[i], [...ancestors, path]);
    }
  }

  compare(a, b, []);
  return { pass: added.length === 0 && removed.length === 0 && changed.length === 0, added, removed, changed };
}

/** Save the current DOM snapshot as a baseline file under
 * `<captures-dir>/dom-baselines/<name>.json`. Returns the file path. */
export async function saveDomBaseline(session: Session, name: string): Promise<string> {
  const base = ensureCapturesDir();
  const dir = base ? path.join(base, 'dom-baselines') : path.join(process.cwd(), 'dev-notes', 'browsy-captures', 'dom-baselines');
  fs.mkdirSync(dir, { recursive: true });
  const snapshot = await captureDomSnapshot(session);
  const filePath = path.join(dir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
}

/** Capture the current DOM and diff it against a saved baseline.
 * Returns { pass, added, removed, changed, baselinePath }. */
export async function compareDom(session: Session, name: string): Promise<DiffResult & { baselinePath: string }> {
  const base = ensureCapturesDir();
  const dir = base ? path.join(base, 'dom-baselines') : path.join(process.cwd(), 'dev-notes', 'browsy-captures', 'dom-baselines');
  const baselinePath = path.join(dir, `${name}.json`);
  const current = await captureDomSnapshot(session);
  let baseline: DomSnapshot;
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } catch {
    throw new Error(`no baseline found at ${baselinePath}. Run browse capture-dom first.`);
  }
  const diff = diffDomSnapshots(baseline, current);
  return { ...diff, baselinePath };
}

