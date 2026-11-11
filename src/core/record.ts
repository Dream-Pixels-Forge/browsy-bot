// Record & replay — serialize CDP sessions to NDJSON for offline debugging.
//
// recordSession(session, path) wraps the session's page connection,
// logging every `send` call and every received event as NDJSON lines to
// `path`. Returns a `stopRecording()` function that restores the original
// connection methods.
//
// replaySession(path) reads the NDJSON file and returns a mock connection
// whose `send` returns the recorded results and whose `on` stores listeners
// for the recorded events. Useful for reproducing flaky failures offline
// without a live browser.

import * as fs from "fs";
import * as path from "path";
import type { CDPConnection } from "./connection.js";
import type { Session } from "./session.js";

type Conn = CDPConnection;

interface RecordedMessage {
  type: "message";
  method: string;
  params?: any;
  result?: any;
  error?: any;
  timestamp: number;
}

interface RecordedEvent {
  type: "event";
  method: string;
  params?: any;
  timestamp: number;
}

/** Record a session's page connection to NDJSON. Returns stopRecording(). */
export async function recordSession(
  session: Session,
  filePath: string
): Promise<{ stopRecording: () => void }> {
  const conn = await session.page();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const originalSend = conn.send;
  const originalOn = conn.on;
  const messages: RecordedMessage[] = [];
  const events: RecordedEvent[] = [];

  // Proxy send
  const proxiedSend = async (method: string, params?: any): Promise<any> => {
    const start = Date.now();
    try {
      const result = await originalSend(method, params);
      messages.push({ type: "message", method, params, result, timestamp: start });
      return result;
    } catch (e: any) {
      messages.push({ type: "message", method, params, error: String(e), timestamp: start });
      throw e;
    }
  };

  // Proxy on
  const proxiedOn = (event: string, callback: (data: any) => void): void => {
    const wrapped = (data: any) => {
      events.push({ type: "event", method: event, params: data.params ?? data, timestamp: Date.now() });
      callback(data);
    };
    originalOn(event, wrapped);
  };

  (conn as any).send = proxiedSend;
  (conn as any).on = proxiedOn;

  let stopped = false;
  const stopRecording = () => {
    if (stopped) return;
    stopped = true;
    (conn as any).send = originalSend;
    (conn as any).on = originalOn;
    // Write NDJSON
    const lines = [
      ...messages.map((m) => JSON.stringify(m)),
      ...events.map((e) => JSON.stringify(e)),
    ];
    fs.writeFileSync(filePath, lines.join("\n") + (lines.length ? "\n" : ""));
  };

  return { stopRecording };
}

/** Replay a recorded NDJSON session. Returns a mock connection. */
export async function replaySession(filePath: string): Promise<Conn> {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.trim().split("\n").filter(Boolean);
  const messages: RecordedMessage[] = [];
  const events: RecordedEvent[] = [];
  for (const line of lines) {
    const parsed = JSON.parse(line);
    if (parsed.type === "message") messages.push(parsed);
    else if (parsed.type === "event") events.push(parsed);
  }

  const listeners = new Map<string, Array<(data: any) => void>>();

  const conn = {
    send: async (method: string, params?: any): Promise<any> => {
      const match = messages.find((m) => m.method === method);
      if (match) return match.result;
      return {};
    },
    on: (event: string, callback: (data: any) => void): void => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(callback);
    },
    close: async () => {},
    isConnected: () => true,
    getTargetId: () => "replayed",
  } as unknown as Conn;

  // Replay events to listeners
  for (const ev of events) {
    const cbs = listeners.get(ev.method);
    if (cbs) {
      for (const cb of cbs) {
        try {
          cb(ev.params);
        } catch {
          // best-effort
        }
      }
    }
  }

  return conn;
}
