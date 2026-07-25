# Design: side-panel chat ↔ Roy (freehire-agent)

Date: 2026-07-24
Repos touched: `freehire-extension` (primary), `freehire-agent` (backend auth)

## Problem

The extension side panel currently chats with a local Rust echo stub
(`server/src/main.rs`, `ws://localhost:3899/ws`) over an extension-private wire
(`ClientEvent`/`ServerEvent` in `extension/lib/protocol.ts`). We want the panel
to talk to the real agent **Roy** (`freehire-agent`, a roy fork) instead —
creating a real session and streaming a real turn — using the same control
protocol the freehire web assistant already speaks (`web/src/lib/assistant`).

## Resolved decisions

1. **Direct connection.** The panel speaks Roy's protocol
   (`ClientCommand`/`ServerEvent`) directly to Roy's `/ws` + `/sessions`. The
   Rust echo stub is removed from the chat path (deleted).
2. **Backend is in scope.** Roy `master` authenticates `/ws` and the protected
   API from the session **cookie only**. The extension is cross-origin and
   cannot send the httpOnly cookie, so we extend Roy to also accept the JWT it
   holds — `Authorization: Bearer` for the HTTP API and a `Sec-WebSocket-Protocol`
   subprotocol for `/ws`.
3. **Local validation.** Roy is run locally; the extension points at it via a
   `ROY_ORIGIN` constant.

## Why the split is small

The freehire web assistant and the extension diverge in exactly one place: the
**auth transport**. Web (same-origin) rides the httpOnly cookie the browser
attaches automatically. The extension (cross-origin, cookie invisible) carries a
JWT and must present it explicitly. Everything else — the wire types, the
`RoyClient`, the `reduceTurnEvent` reducer, the turn sequence — is reused
verbatim.

The subprotocol convention already exists in the ecosystem: roy-web opens
`new WebSocket(url, ['roy-jwt', token])` (marker + token), and
`freehire-agent`'s `roy_auth::verify_ws_protocol` already parses
`Sec-WebSocket-Protocol: roy-jwt,<JWT>`. Only the `ws_handler` wiring is missing.

## Component design

### A. Backend — `freehire-agent`

Two surgical changes, both reusing existing primitives:

- **`crates/roy-management/src/auth.rs` → `require_user`**: cookie stays primary;
  add a fallback that reads `Authorization: Bearer <jwt>` and verifies it via
  `jwt::verify_session(token, secret_from_env())`. Covers the `/sessions`
  endpoints the extension calls (`POST`, `GET`, `DELETE`). No change to the
  `AuthUser` extension shape.
- **`crates/roy-management/src/ws.rs` → `ws_handler`**: after the existing
  cookie check, fall back to `roy_auth::verify_ws_protocol(<sec-websocket-protocol>)`.
  On success, upgrade with `ws.protocols(["roy-jwt"])` so axum echoes the marker
  back (required for browser clients). The per-command `authorize` /
  ownership-check logic in the relay is unchanged.

Tests (mirroring the existing style in `ws.rs`/`http.rs`):
- WS handshake with `roy-jwt,<valid-jwt>` subprotocol upgrades (and the response
  selects `roy-jwt`).
- WS with a missing marker or garbage token → 401.
- Cookie path still works (regression).
- `POST /sessions` with `Authorization: Bearer <valid-jwt>` creates a session;
  a bad bearer → 401.

### B. Extension — protocol client port

New module `extension/lib/roy/`, a thin port of `web/src/lib/assistant`:

- `wire.ts` — `ClientCommand` / `ServerEvent` / `TurnEvent` / `JournalEntry`
  types (copy; types only).
- `client.ts` — `RoyClient` (`call` / `fire` / `subscribeFrames` / `onStatus` /
  `onError`), but `connect(url, token)` opens
  `new WebSocket(url, ['roy-jwt', token])` (subprotocol auth, as roy-web does) —
  NOT the cookie variant the freehire web client uses.
- `chat.ts` — `reduceTurnEvent` + `ChatState` / `ChatMessage` (copy of the pure
  reducer: `text` / `thinking` / `tools` / `streaming` / `errored`).
- `session.ts` — `createSession(token)`:
  `POST ${ROY_ORIGIN}/sessions` with `Authorization: Bearer`, body `{}` →
  `session_id`; and `royWsUrl()` (swap `http`→`ws`, append `/ws`).

Config: a `ROY_ORIGIN` constant next to `HIRE_ORIGIN` in `extension/lib/auth.ts`
(mirrors the existing hardcoded-dev-default pattern; no new `config.ts`).

### C. `App.svelte` — swap raw WebSocket for `RoyClient`

- Remove `new WebSocket('ws://localhost:3899/ws')` and `parseServerEvent`.
- Chat is gated behind sign-in (Roy requires the JWT).
- Turn flow (faithful to `AssistantChat.svelte`): on the first send, lazily
  `createSession(token)` → `client.connect(royWsUrl(), token)` →
  `subscribeFrames(id, …)` **before** attaching →
  `call({op:'attach', session:id, from_seq:0}, 'attached')`. Then per message:
  `call({op:'acquire_input', session:id}, 'input_acquired')` →
  `fire({op:'send', session:id, text})`; incoming frames fold through
  `reduceTurnEvent` into the message list. The status line reads
  `client.onStatus`.
- **"Read page"**: with the stub gone, the button now sends the page snapshot to
  Roy as a context-prefixed `send` message — the page→agent path is preserved,
  now hitting the real agent. Autofill (local + hire API) is untouched.
- Rendering (MVP): show assistant `text` with a streaming indicator.
  `thinking` / `tools` accumulate in the model (the reducer keeps them) but are
  not expanded in the UI yet — a later polish.

### D. Remove the echo stub

- Delete the `server/` directory.
- In `extension/lib/protocol.ts`, drop the WS half (`ClientEvent`,
  `ServerEvent`, `parseServerEvent`) — it served only the stub. Keep
  `PageSnapshot` / `FormField` / `Fill` / `RuntimeMessage` (used by
  content/background/autofill).
- Update `AGENTS.md` where the stub is described as the agent seam.

## Data flow (one turn)

```
panel                          Roy /ws (relay)            roy daemon
  │  POST /sessions (Bearer) ─────────────────────────────▶ spawn
  │  ◀── { session_id }
  │  WS connect [roy-jwt, jwt] ──▶ verify_ws_protocol, upgrade
  │  subscribeFrames(id)
  │  attach(from_seq:0) ─────────▶ authorize(owns?) ──────▶ attach
  │  ◀── attached / frame* (journal replay)
  │  acquire_input ──────────────▶ ───────────────────────▶ lease
  │  ◀── input_acquired
  │  send(text) (fire) ──────────▶ ───────────────────────▶ turn
  │  ◀── frame(assistant_text)* … frame(result)
  │  reduceTurnEvent → render
```

## Testing

- Extension (vitest / happy-dom): port `chat.test.ts`; `client.test.ts` with a
  fake `WebSocket` (asserts `connect` offers `['roy-jwt', token]`, FIFO `call`
  matching, frame dispatch); `session.test.ts` with mocked `fetch` (Bearer
  header, `session_id` parse).
- Backend: the Rust unit tests listed in A.
- Live: Roy run locally, `ROY_ORIGIN` supplied; end-to-end pass (sign-in →
  message → streamed reply) in a throwaway run.

## Out of scope (noted seams for later)

- Expanding `thinking` / `tool_use` in the panel UI.
- Session sidebar / multi-session switching (`listSessions`, delete).
- Feeding structured page context as first-class session context (beyond the
  "Read page" message).
- Publishing the extension / enabling the flow on prod Roy.
```
