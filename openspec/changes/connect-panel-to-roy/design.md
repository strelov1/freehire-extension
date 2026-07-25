## Context

The side panel chats with a local Rust echo stub (`server/`, `ws://localhost:3899/ws`)
over an extension-private wire. Roy (`freehire-agent`) is the real agent and
already exposes the session + turn protocol the freehire web assistant speaks
(`web/src/lib/assistant`). The web assistant authenticates same-origin via the
httpOnly session cookie; the extension is cross-origin and cannot send that
cookie, but it already holds an equivalent session JWT (the "Sign in with
freehire" connect flow). Full design basis:
`docs/superpowers/specs/2026-07-24-panel-roy-chat-design.md`.

## Goals / Non-Goals

**Goals:**
- Panel creates a real Roy session and streams one real turn.
- Reuse the web assistant's wire, client, and reducer verbatim; diverge only on
  the auth transport (Bearer + subprotocol instead of cookie).
- Remove the echo stub cleanly.

**Non-Goals:**
- Expanding `thinking` / `tool_use` in the panel UI (reducer keeps them; UI shows
  `text` + a streaming indicator).
- Session sidebar / multi-session switching.
- First-class structured page context beyond the "Read page" message.
- Publishing the extension or enabling the flow on prod Roy.

## Decisions

**Direct connection, stub removed.** The panel speaks Roy's protocol directly.
Alternative — keep the Rust stub as a proxy to Roy — was rejected: it would
duplicate the protocol and auth for no benefit, and the task calls for a client
"по протоколу из web/src/lib/assistant".

**Auth transport = JWT, two carriers.** `Authorization: Bearer` for the HTTP API,
`Sec-WebSocket-Protocol: roy-jwt,<jwt>` for `/ws`. This matches the established
roy-web convention (`new WebSocket(url, ['roy-jwt', token])`) and reuses the
already-present `roy_auth::verify_ws_protocol`. Alternative — a cookie shim —
was rejected: the extension is cross-origin and the cookie is httpOnly and
invisible to extension JS.

**Backend fallback, cookie stays primary.** In Roy, cookie auth is tried first
and the Bearer/subprotocol paths are fallbacks, so the same-origin web app is
untouched. This confines blast radius and keeps one code path per client type.

**Port, don't share.** The extension gets its own `extension/lib/roy/` copy of
`wire.ts` / `client.ts` / `chat.ts` (the web module is SvelteKit-coupled via
`$env`/`$lib`). The only behavioral change from the web copies is
`RoyClient.connect(url, token)` opening the subprotocol WebSocket.

**`ROY_ORIGIN` as a constant.** Mirrors the existing `HIRE_ORIGIN` hardcoded-dev
pattern in `extension/lib/auth.ts`; no new config module (YAGNI).

## Risks / Trade-offs

- [Bearer accepted on all protected routes] → Scope is the same session JWT the
  cookie already trusts; unified auth is the intended model. Cookie stays
  primary; no new secret or grant is introduced.
- [Browser drops the socket if the server does not echo a selected subprotocol]
  → `ws_handler` upgrades with `protocols(["roy-jwt"])` so the marker is echoed;
  a backend test asserts the selected subprotocol.
- [Roy not reachable / no harness credential locally] → Panel surfaces the
  connect/create error; operator configures Roy for local runs (out of code
  scope).
- [Cross-repo change under one OpenSpec change] → The freehire-agent edits are an
  explicit task group here; OpenSpec artifacts stay repo-local to the extension.

## Migration Plan

Internal-only. Removing `server/` and the stub wire is safe — nothing else
consumes them. The flow is inert on prod Roy until `ROY_ORIGIN` points at a Roy
that has the auth fallbacks deployed; local validation only for this change.

## Open Questions

None blocking. "Read page" behavior (send page snapshot as a context-prefixed
message) is confirmed as the minimal path for this slice.
