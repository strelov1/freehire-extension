## Why

The side-panel chat currently talks to a local Rust echo stub over an
extension-private wire — it can only echo, not act. To make the panel a real
agent surface, it must talk to Roy (`freehire-agent`), creating a real session
and streaming a real turn over the same control protocol the freehire web
assistant already speaks.

## What Changes

- The panel speaks Roy's `ClientCommand`/`ServerEvent` protocol **directly** to
  Roy's `/ws` and `/sessions` (ported from `web/src/lib/assistant`).
- Auth crosses origins via the JWT the extension already holds:
  `Authorization: Bearer` for `POST /sessions`, and a
  `Sec-WebSocket-Protocol: roy-jwt,<JWT>` subprotocol for `/ws`.
- `App.svelte` drives the real turn sequence
  (`attach` → `acquire_input` → `send` → stream frames → `result`) instead of
  the raw echo WebSocket.
- **BREAKING (internal):** the Rust echo stub (`server/`) is removed, and the
  stub-only WS half of `extension/lib/protocol.ts`
  (`ClientEvent`/`ServerEvent`/`parseServerEvent`) is deleted.
- Backend (sibling repo `freehire-agent`): `require_user` also accepts
  `Authorization: Bearer`; `ws_handler` also accepts the `roy-jwt` subprotocol
  and echoes the marker back. (Cookie auth stays primary — the web app is
  unaffected.)

## Capabilities

### New Capabilities
- `panel-agent-chat`: the side panel creates a Roy session and holds a
  JWT-authenticated WebSocket to Roy, driving one chat turn end-to-end
  (send a message, stream the agent's reply) and feeding the current page to the
  agent via "Read page".

### Modified Capabilities
<!-- None: the extension had no prior OpenSpec specs; the freehire-agent auth
     change lives in that repo and is tracked here only as an implementation
     task, not as a spec of this repo. -->

## Impact

- **freehire-extension**: new `extension/lib/roy/` module (wire, client, chat
  reducer, session); `App.svelte` rewired; `server/` deleted;
  `extension/lib/protocol.ts` trimmed; `AGENTS.md` updated; a `ROY_ORIGIN`
  constant added. Auth (`extension/lib/auth.ts`) is reused for the JWT.
- **freehire-agent** (sibling repo): `crates/roy-management/src/auth.rs`
  (`require_user` bearer fallback) and `crates/roy-management/src/ws.rs`
  (`ws_handler` subprotocol fallback + echo). Reuses the existing
  `roy_auth::verify_ws_protocol` and `jwt::verify_session` primitives.
- **Dependencies**: none new. Roy must be reachable at `ROY_ORIGIN` with a
  harness credential configured (operator responsibility for local runs).

Full design basis: `docs/superpowers/specs/2026-07-24-panel-roy-chat-design.md`.
