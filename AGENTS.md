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
agent is [`freehire-agent`](../freehire-agent) (Roy): the side panel creates a
Roy session and streams the turn over Roy's own control protocol.

**Current state: the chat is wired to Roy.** Sign in with freehire, then talk to
the agent; "Read page" hands the current page to it. Auth crosses origins with
the session JWT (`Authorization: Bearer` on the HTTP API, the `roy-jwt` WebSocket
subprotocol on `/ws`). A profile-aware match card and deterministic Autofill also
ship.

Stack: **WXT + Svelte** (Chrome MV3). No local server — the panel talks to Roy
directly.

## Layout

```
extension/            WXT + Svelte MV3 extension
  entrypoints/
    background.ts     service worker: opens the panel, relays panel <-> content
    content.ts        injected everywhere; reads the page into a PageSnapshot
    sidepanel/        Svelte chat app (owns the Roy WebSocket)
      App.svelte      chat UI + match card + "Read page" + Autofill
      MatchCard.svelte  profile-match card
      main.ts         Svelte 5 mount
  lib/
    roy/              Roy control-protocol client: wire, client (RoyClient),
                      chat reducer, session bootstrap (+ tests). Ported from the
                      freehire web assistant; auth diverges (Bearer + subprotocol).
    tools/            browser-tool executor: the wire contract, the executeTool
                      dispatch (+ tests), the ToolChannel socket to hire's relay,
                      and the PageBridge that reaches the tab's frames.
    auth.ts           "Sign in with freehire" (launchWebAuthFlow) + token storage
    freehire.ts       hire API reads (job, match, autofill profile)
    protocol.ts       in-extension RuntimeMessage contract (+ test)
    scraper.ts        DOM -> PageSnapshot, pure over its Document arg (+ test)
    form.ts           form observe/map/act for Autofill (+ test)
  wxt.config.ts       manifest (permissions, side_panel, host_permissions)
```

## Architecture

- **Side panel** (Svelte) owns the Roy WebSocket. It's the only context that
  stays alive while open — unlike the MV3 service worker, which Chrome kills when
  idle, so it must not hold the durable socket.
- **Content script** reads the live DOM on request. It holds no state.
- **Background** is a thin relay: the panel can't message a content script
  directly, so background forwards a snapshot request to the active tab.

The chat talks to Roy directly over its `ClientCommand`/`ServerEvent` control
protocol (`lib/roy/`): create a session (`POST /sessions`), connect the
WebSocket, then `attach` → `acquire_input` → `send`, folding the streamed
`TurnEvent`s into the message list. Auth is the session JWT the connect flow
minted — `Authorization: Bearer` on the HTTP API, the `roy-jwt` WebSocket
subprotocol on `/ws` (the httpOnly cookie the web app relies on is invisible to
extension code).

Read-a-page flow:

```
panel --GET_PAGE_SNAPSHOT--> background --(active tab)--> content
content --PAGE_SNAPSHOT--> background --> panel
panel --send(page context)--> Roy --frames(reply)--> panel
```

## Conventions

- **`protocol.ts` is the in-extension contract** — `RuntimeMessage`
  (panel <-> background <-> content, discriminated by `kind`). The chat's wire is
  NOT here; it lives in `lib/roy/wire.ts`, mirroring Roy's protocol.
- **`lib/roy/` mirrors the freehire web assistant** (`web/src/lib/assistant` in
  the hire repo). wire/client/chat are thin ports; the one divergence is auth
  (subprotocol + Bearer instead of the web's cookie). Keep them aligned.
- **Test the logic, not the transport.** `scraper`, `form`, `protocol`, and the
  `roy` client/reducer are pure and tested (vitest); the chrome message plumbing
  and the live socket are thin glue.
- **TypeScript stays on 5.x** — svelte-check does not yet support the native
  `typescript@7` (tsgo).

## Commands

```bash
# Roy (the agent) must be reachable at ROY_ORIGIN (see lib/roy/session.ts).
# Run freehire-agent locally: `roy management` (ROY_MANAGEMENT_ADDR, default
# 127.0.0.1:8079) serves /sessions + /ws. Its ROY_JWT_SECRET must match hire's.

cd extension && npm install          # runs `wxt prepare` (generates .wxt/)
cd extension && npm run dev          # dev build with HMR
cd extension && npm run build        # production build -> .output/chrome-mv3
cd extension && npm test             # vitest: scraper + protocol + form + roy
cd extension && npm run check        # svelte-check
```

Load unpacked in Chrome: `chrome://extensions` → Developer mode → **Load
unpacked** → `extension/.output/chrome-mv3`. Click the toolbar icon to open the
panel.
