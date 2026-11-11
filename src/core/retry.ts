// Retry resilience — retry flaky actions with exponential backoff.
//
// retryableAction(session, fn, options) calls `fn` and retries on failure
// with exponential backoff (baseDelayMs * 2^attempt). If `captureOnRetry`
// is set, a full-page screenshot is captured to
// dev-notes/browsy-captures/retries/ between attempts for debugging.
//
// Useful for flaky selectors, intermittent network issues, and SPAs that
// need an extra render pass.

import { fullPageScreenshot } from "./actions.js";
import { writeScreenshot } from "./capture.js";
import { ensureCapturesDir } from "./capture.js";
import type { Session } from "./session.js";

interface RetryOptions {
  /** Max number of attempts. Default 3. */
  maxAttempts?: number;
  /** Base delay in ms. Delay grows as baseDelayMs * 2^attempt. Default 500. */
  baseDelayMs?: number;
  /** Capture a screenshot to dev-notes/browsy-captures/retries/ between
   * attempts. Default false. */
  captureOnRetry?: boolean;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Retry `fn` with exponential backoff until it succeeds or maxAttempts is reached. */
export async function retryableAction<T>(
  session: Session,
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const captureOnRetry = options.captureOnRetry ?? false;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      if (captureOnRetry) {
        await captureAndSave(session, attempt);
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
    }
  }
  throw lastError ?? new Error("retryableAction failed without error");
}

/** Capture a full-page screenshot and save it to the retries directory. */
async function captureAndSave(session: Session, attempt: number): Promise<void> {
  try {
    const dir = ensureCapturesDir();
    if (!dir) return;
    const retryDir = `${dir}/retries`;
    const data = await fullPageScreenshot(session);
    const filePath = `${retryDir}/retry-attempt-${attempt}.png`;
    writeScreenshot(data, filePath);
  } catch {
    // Best-effort: capture failures must not mask the original error.
  }
}
