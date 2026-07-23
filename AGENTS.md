# AGENTS.md

Guidance for AI agents working in this repository.

## Working principles

Non-negotiable. Bias toward caution over speed; use judgment on trivial tasks.

- **Think before coding.** Surface assumptions. If multiple interpretations
  exist, present them — don't pick silently. If something is unclear, ask.
- **Simplicity first.** Minimum code that solves the problem. No features,
  abstractions, or error handling that wasn't asked for.
- **Surgical changes.** Touch only what the task requires. Match existing style.
- **Fix root causes, not symptoms.**
- **No overengineering, and no MVP shortcuts.** Note the seam for later instead
  of building infrastructure early; never ship "for now" hacks.
- **MVP stage — keep the architecture fluid.** This repo is a fresh scaffold;
  reshape it freely when a feature doesn't fit, rather than bolting on special
  cases.
- **English only.** Code, comments, identifiers, docs, and commits in English.

## What this is

A browser extension that puts a job-application **agent in a side panel** — a
Claude/Gemini-style side bar with access to whatever page the user is on. The
agent's brain lives behind a local server; that server is meant to bridge to the
existing [`freehire-agent`](../freehire-agent) (Roy) later. This repo is the
browser surface plus the server seam.

**Current state: scaffolding.** The wiring is real end-to-end; the "agent" is a
mock echo. No real agent, auth, profile context, or form-filling yet — those are
follow-up specs (tracked in OpenSpec from the next one on).

Stack: **WXT + Svelte** (Chrome MV3), **Rust + axum** WebSocket server.

## Layout

```
extension/            WXT + Svelte MV3 extension
  entrypoints/
    background.ts     service worker: opens the panel, relays panel <-> content
    content.ts        injected everywhere; reads the page into a PageSnapshot
    sidepanel/        Svelte chat app (owns the WebSocket to the server)
      App.svelte      chat UI + "Read page" + WebSocket lifecycle
      main.ts         Svelte 5 mount
  lib/
    protocol.ts       single source of truth for every message shape (+ test)
    scraper.ts        DOM -> PageSnapshot, pure over its Document arg (+ test)
  wxt.config.ts       manifest (permissions, side_panel, host_permissions)
server/               Rust WebSocket stub (axum)
  src/main.rs         ws handler + mock_reply seam (+ tests)
```

## Architecture

Three moving parts, one contract (`extension/lib/protocol.ts`):

- **Side panel** (Svelte) owns the WebSocket. It's the only context that stays
  alive while open — unlike the MV3 service worker, which Chrome kills when idle,
  so it must not hold the durable socket.
- **Content script** reads the live DOM on request. It holds no state.
- **Background** is a thin relay: the panel can't message a content script
  directly, so background forwards a snapshot request to the active tab.

Read-a-page flow:

```
panel --GET_PAGE_SNAPSHOT--> background --(active tab)--> content
content --PAGE_SNAPSHOT--> background --> panel --page_context(ws)--> server
server --assistant_message(ws)--> panel
```

## Conventions

- **`protocol.ts` is the contract.** Two transports live there on purpose:
  `RuntimeMessage` (inside the extension, discriminated by `kind`) and
  `ClientEvent`/`ServerEvent` (over the WebSocket, discriminated by `type`).
  Different discriminant keys are deliberate — two channels, two lifecycles.
- **The server mirrors only the WebSocket half** via serde (`#[serde(tag =
  "type")]`). Keep the Rust enums in lockstep with the TS types.
- **The agent seam is `mock_reply`** in `server/src/main.rs`. Replace its body to
  bridge to Roy; the wire contract does not move.
- **Test the logic, not the transport.** `scraper` and `protocol` are pure and
  tested (vitest); `mock_reply` is pure and tested (cargo). The axum ws handler
  and the chrome message plumbing are thin glue — left uncovered on purpose.
- **TypeScript stays on 5.x** — svelte-check does not yet support the native
  `typescript@7` (tsgo).

## Commands

```bash
# Rust WS server (ws://localhost:3899/ws)
cd server && cargo run
cd server && cargo test

# Extension
cd extension && npm install          # runs `wxt prepare` (generates .wxt/)
cd extension && npm run dev          # dev build with HMR
cd extension && npm run build        # production build -> .output/chrome-mv3
cd extension && npm test             # vitest: scraper + protocol
cd extension && npm run check        # svelte-check
```

Load unpacked in Chrome: `chrome://extensions` → Developer mode → **Load
unpacked** → `extension/.output/chrome-mv3`. Click the toolbar icon to open the
panel.
