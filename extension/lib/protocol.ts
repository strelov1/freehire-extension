/**
 * Single source of truth for every message shape crossing a boundary.
 *
 * Two independent transports live here on purpose:
 *  - RuntimeMessage — inside the extension, over chrome.runtime
 *    (panel <-> background <-> content). Discriminated by `kind`.
 *  - ClientEvent / ServerEvent — over the WebSocket to the server
 *    (panel <-> server). Discriminated by `type`.
 *
 * The Rust server mirrors only the WebSocket half of this contract.
 */

/** A read of whatever page the user is currently looking at. */
export interface PageSnapshot {
  url: string;
  title: string;
  /** Best-effort primary heading of the page (e.g. a job title). */
  headline: string;
  /** Visible text, trimmed and length-capped. */
  text: string;
}

/** Messages passed inside the extension via chrome.runtime. */
export type RuntimeMessage =
  | { kind: 'GET_PAGE_SNAPSHOT' }
  | { kind: 'PAGE_SNAPSHOT'; snapshot: PageSnapshot };

/** Envelopes the panel sends to the server over the WebSocket. */
export type ClientEvent =
  | { type: 'user_message'; text: string }
  | { type: 'page_context'; snapshot: PageSnapshot };

/** Envelopes the server sends back to the panel over the WebSocket. */
export type ServerEvent = { type: 'assistant_message'; text: string };

/** An empty snapshot, used when no active tab can be read. */
export function emptySnapshot(): PageSnapshot {
  return { url: '', title: '', headline: '', text: '' };
}

/** Narrows arbitrary WebSocket JSON to a known ServerEvent, or null. */
export function parseServerEvent(raw: unknown): ServerEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const event = raw as Record<string, unknown>;
  if (event.type === 'assistant_message' && typeof event.text === 'string') {
    return { type: 'assistant_message', text: event.text };
  }
  return null;
}
