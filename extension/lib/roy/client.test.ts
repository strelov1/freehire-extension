import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RoyClient } from './client';
import { WS_SUBPROTOCOL_MARKER } from './wire';

/** Minimal stand-in for the browser WebSocket, driven manually by the test. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  protocols?: string | string[];
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  // --- test drivers ---
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  emit(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

let original: typeof WebSocket;

beforeEach(() => {
  original = globalThis.WebSocket;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
});

afterEach(() => {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = original;
});

/** Connect a client and drive the socket to OPEN. Returns the fake socket. */
async function connected(): Promise<{ client: RoyClient; ws: FakeWebSocket }> {
  const client = new RoyClient();
  const p = client.connect('ws://roy/ws', 'jwt-token');
  const ws = FakeWebSocket.instances[0];
  ws.open();
  await p;
  return { client, ws };
}

describe('RoyClient', () => {
  it('offers the roy-jwt marker + token as subprotocols and opens', async () => {
    const client = new RoyClient();
    const p = client.connect('ws://roy/ws', 'jwt-123');
    const ws = FakeWebSocket.instances[0];
    expect(ws.protocols).toEqual([WS_SUBPROTOCOL_MARKER, 'jwt-123']);
    ws.open();
    await p;
    expect(client.status).toBe('open');
  });

  it('resolves a call when the matching server event arrives', async () => {
    const { client, ws } = await connected();
    const call = client.call({ op: 'attach', session: 's1', from_seq: 0 }, 'attached');
    expect(JSON.parse(ws.sent[0]!)).toEqual({ op: 'attach', session: 's1', from_seq: 0 });
    ws.emit({ kind: 'attached', session: 's1', seq_at_attach: 0, harness: 'claude' });
    const ev = await call;
    expect(ev.kind).toBe('attached');
  });

  it('rejects a call when the backend answers with an error', async () => {
    const { client, ws } = await connected();
    const call = client.call({ op: 'acquire_input', session: 's1' }, 'input_acquired');
    ws.emit({ kind: 'error', code: 'no_lease', message: 'busy', session: 's1' });
    await expect(call).rejects.toThrow(/no_lease/);
  });

  it('dispatches frame events to subscribers', async () => {
    const { client, ws } = await connected();
    const seen: unknown[] = [];
    client.subscribeFrames('s1', (entry) => seen.push(entry.event));
    ws.emit({
      kind: 'frame',
      session: 's1',
      entry: { seq: 1, ts_ms: 0, event: { type: 'assistant_text', text: 'hi' } },
    });
    expect(seen).toEqual([{ type: 'assistant_text', text: 'hi' }]);
  });

  it('routes an unsolicited error to onError subscribers', async () => {
    const { client, ws } = await connected();
    const errs: unknown[] = [];
    client.onError((e) => errs.push(e));
    ws.emit({ kind: 'error', code: 'forbidden', message: 'nope', session: 's1' });
    expect(errs).toEqual([{ code: 'forbidden', message: 'nope', session: 's1' }]);
  });
});
