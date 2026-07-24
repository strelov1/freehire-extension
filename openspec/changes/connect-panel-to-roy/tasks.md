## 1. Backend auth (freehire-agent, sibling repo)

- [ ] 1.1 `require_user` (`crates/roy-management/src/auth.rs`): accept `Authorization: Bearer <jwt>` as a fallback when no valid cookie is present, verifying via `jwt::verify_session` + `secret_from_env`; add a unit test (valid bearer resolves the user; bad bearer → 401; cookie path unchanged)
- [ ] 1.2 `ws_handler` (`crates/roy-management/src/ws.rs`): fall back to `roy_auth::verify_ws_protocol` when the cookie is absent, and upgrade with `ws.protocols(["roy-jwt"])` so the marker is echoed; add unit tests (valid `roy-jwt,<jwt>` subprotocol upgrades and selects `roy-jwt`; missing marker / bad token → 401; cookie path still works)
- [ ] 1.3 `cargo test` + `cargo clippy` green for `freehire-agent`

## 2. Extension protocol client (port from web/src/lib/assistant)

- [ ] 2.1 `extension/lib/roy/wire.ts`: `ClientCommand` / `ServerEvent` / `TurnEvent` / `JournalEntry` types (types-only copy; verified by svelte-check)
- [ ] 2.2 `extension/lib/roy/chat.ts`: `reduceTurnEvent` + `ChatState`/`ChatMessage`; port `chat.test.ts`
- [ ] 2.3 `extension/lib/roy/client.ts`: `RoyClient` (`call`/`fire`/`subscribeFrames`/`onStatus`/`onError`), `connect(url, token)` opening `new WebSocket(url, ['roy-jwt', token])`; `client.test.ts` with a fake `WebSocket` (asserts offered subprotocols, FIFO `call` matching, frame dispatch, unsolicited-error routing)
- [ ] 2.4 `extension/lib/roy/session.ts`: `createSession(token)` (Bearer, empty body, parse `session_id`) + `royWsUrl()`; `ROY_ORIGIN` constant next to `HIRE_ORIGIN`; `session.test.ts` with mocked `fetch`

## 3. Panel wiring (App.svelte)

- [ ] 3.1 Replace the raw `WebSocket('ws://localhost:3899/ws')` + `parseServerEvent` with the `RoyClient` turn flow: lazily `createSession` on first send, `connect`, `subscribeFrames` before `attach(from_seq:0)`, then `acquire_input` → `fire(send)`; fold frames through `reduceTurnEvent`; drive the status line from `client.onStatus`
- [ ] 3.2 Gate chat behind sign-in (require a stored JWT); surface connect/turn errors instead of leaving a message streaming
- [ ] 3.3 "Read page": send the page snapshot to Roy as a context-prefixed `send` message (no stub round trip); leave Autofill untouched

## 4. Remove the echo stub

- [ ] 4.1 Delete the `server/` directory
- [ ] 4.2 Trim `extension/lib/protocol.ts`: remove `ClientEvent` / `ServerEvent` / `parseServerEvent`; keep `PageSnapshot` / `FormField` / `Fill` / `RuntimeMessage`; fix any imports
- [ ] 4.3 Update `AGENTS.md` where the stub is described as the agent seam

## 5. Verify

- [ ] 5.1 Extension: `vitest run` + `svelte-check` + `wxt build` green
- [ ] 5.2 Live end-to-end against a local Roy (`ROY_ORIGIN`): sign in → send a message → see a streamed reply; "Read page" reaches the agent
