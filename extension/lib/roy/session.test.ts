import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSession, royWsUrl, ROY_ORIGIN } from './session';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createSession', () => {
  it('POSTs an empty body with a Bearer token and returns session_id', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ session_id: 'sess-9' }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const id = await createSession('jwt-abc');

    expect(id).toBe('sess-9');
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe(`${ROY_ORIGIN}/sessions`);
    const init = call[1]!;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-abc');
    expect(init.body).toBe('{}');
  });

  it('throws when the response lacks session_id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 201 })));
    await expect(createSession('t')).rejects.toThrow(/session_id/);
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    await expect(createSession('t')).rejects.toThrow(/401/);
  });
});

describe('royWsUrl', () => {
  it('derives the ws URL from the origin', () => {
    expect(royWsUrl()).toBe(`${ROY_ORIGIN.replace(/^http/, 'ws')}/ws`);
  });
});
