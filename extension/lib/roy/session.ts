// Roy (freehire-agent) session bootstrap. Auth crosses origins via the session
// JWT the extension holds (the "Sign in with freehire" connect flow): the HTTP
// API takes `Authorization: Bearer`, and the WebSocket takes the `roy-jwt`
// subprotocol (see client.ts). The httpOnly cookie the web app uses is invisible
// to extension code, so it is never relied on here.

/** Where Roy runs. Set `WXT_ROY_ORIGIN` to build against a deployment
 *  (`.env.production` points at agent.freehire.me); the default is your local
 *  Roy — the `roy management` server (`ROY_MANAGEMENT_ADDR`, default
 *  127.0.0.1:8079) serves both the HTTP API and, ws-swapped, `/ws`. */
export const ROY_ORIGIN = import.meta.env.WXT_ROY_ORIGIN ?? 'http://localhost:8079';

/** Roy's WebSocket URL, derived from the same origin as the HTTP calls. */
export function royWsUrl(): string {
  return `${ROY_ORIGIN.replace(/^http/, 'ws')}/ws`;
}

/** Create a Roy session for the signed-in user. The backend decides everything
 *  (harness, persona, sandbox, scope) from the empty body; we only read back the
 *  `session_id` the WebSocket turn attaches to. */
export async function createSession(token: string): Promise<string> {
  const res = await fetch(`${ROY_ORIGIN}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`could not create session (${res.status})`);
  const body = (await res.json()) as { session_id?: string };
  if (!body?.session_id) throw new Error('session response missing session_id');
  return body.session_id;
}
