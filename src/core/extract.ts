// Structured data extraction — pull fields out of matching elements as
// plain JSON records, without the consumer writing bespoke Runtime.evaluate
// scripts (the fragile path the README warns about).
//
// `extract(session, selector, fields, options?)` runs one in-page script
// that queries `document.querySelectorAll(selector)` and, for each element
// (capped by `options.limit`), builds a record of the requested fields.
//
// Field specs:
//   "text"         -> el.innerText
//   "html"         -> el.innerHTML
//   "textContent"  -> el.textContent (trimmed)
//   "value"        -> el.value (null for non-form elements)
//   "attr:<name>"  -> el.getAttribute(name), keyed by <name> (null if absent)
//
// Anything else is treated as an unknown spec and the field resolves to null
// (documented, not an error) so a bad spec degrades gracefully instead of
// throwing.

import { CDPConnection } from './connection.js';
import { Runtime } from './types.js';
import type { Session } from './session.js';

export interface ExtractOptions {
  /** Cap the number of records returned (all matches if omitted). */
  limit?: number;
  /** Fallback selectors to try if the primary selector matches no elements. */
  fallbacks?: string[];
}

/**
 * Extract structured data from all elements matching `selector`.
 * Returns one record per element (capped by `options.limit`).
 *
 * With `{ fallbacks: [...] }`: tries each fallback selector in order if the
 * primary selector matches no elements.
 */
export async function extract(
  session: Session,
  selector: string,
  fields: string[],
  options: ExtractOptions = {},
): Promise<Record<string, unknown>[]> {
  if (options.fallbacks && options.fallbacks.length > 0) {
    const selectors = [selector, ...options.fallbacks];
    for (const sel of selectors) {
      const records = await extract(session, sel, fields, { limit: options.limit });
      if (records.length > 0) {
        return records;
      }
    }
    return [];
  }

  const conn: CDPConnection = await session.page();
  const limit = options.limit ?? null;

  const script = `(function(){
    const fields = ${JSON.stringify(fields)};
    const limit = ${JSON.stringify(limit)};
    const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const out = [];
    for (let i = 0; i < els.length && (limit == null || out.length < limit); i++) {
      const el = els[i];
      const rec = {};
      for (const f of fields) {
        if (f === 'text') rec[f] = el.innerText ?? null;
        else if (f === 'html') rec[f] = el.innerHTML;
        else if (f === 'textContent') rec[f] = (el.textContent ?? '').trim();
        else if (f === 'value') rec[f] = el.value ?? null;
        else if (f.startsWith('attr:')) rec[f.slice(5)] = el.getAttribute(f.slice(5));
        else rec[f] = null;
      }
      out.push(rec);
    }
    return out;
  })()`;

  const res = await conn.send<{ result?: Runtime.RemoteObject; exceptionDetails?: Runtime.ExceptionDetails }>(
    'Runtime.evaluate',
    { expression: script, returnByValue: true, awaitPromise: true },
  );
  if (res?.exceptionDetails) {
    const d = res.exceptionDetails as Runtime.ExceptionDetails & { exception?: { description?: string } };
    throw new Error(d.exception?.description ?? d.text ?? 'extract: page JS threw');
  }
  const value = res?.result?.value;
  if (!Array.isArray(value)) {
    throw new Error('extract: expected an array of records from the page');
  }
  return value as Record<string, unknown>[];
}
