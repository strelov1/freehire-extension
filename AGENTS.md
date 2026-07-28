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
agent is **freehire's own**, running inside hire's API (`internal/assistant`):
the panel holds a conversation under the `browse` preset, whose agent can read
the open page through the browser-tool relay this extension serves.

**Current state: the chat runs on hire's assistant.** Sign in with freehire and
talk to it; there is no "read page" affordance, because the agent calls
`read_current_page` itself when a question needs it. A profile-aware match card,
page intake and agent-driven Autofill also ship.

Everything reaches one origin. Auth crosses it with the session JWT the connect
flow minted: `Authorization: Bearer` on the HTTP API, the `freehire-jwt`
subprotocol on the relay's WebSocket (a browser cannot set headers on
`new WebSocket`).

Stack: **WXT + Svelte** (Chrome MV3). No local server, and no separate agent
service.

## Layout

```
extension/            WXT + Svelte MV3 extension
  entrypoints/
    background.ts     service worker: opens the panel, relays panel <-> content
    content.ts        injected everywhere; reads the page into a PageSnapshot
    sidepanel/        Svelte chat app (owns the relay WebSocket)
      App.svelte      chat UI + match card + page intake + Autofill
      MatchCard.svelte  profile-match card
      ToolGroupList.svelte  what the agent is doing, mid-turn
      JobDeck.svelte / JobDeckCard.svelte  the `present_jobs` cards
      main.ts         Svelte 5 mount
  lib/
    assistant/        the chat: SSE reader, wire types, chat + deck reducers,
                      tool formatters, the session store, and the API and turn
                      clients (+ tests). Ported from the freehire web assistant.
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

- **Side panel** (Svelte) owns the relay WebSocket. It's the only context that
  stays alive while open — unlike the MV3 service worker, which Chrome kills when
  idle, so it must not hold the durable socket. The chat needs no socket at all;
  each turn is its own request.
- **Content script** reads the live DOM on request. It holds no state.
- **Background** is a thin relay: the panel can't message a content script
  directly, so background forwards a snapshot request to the active tab.

A turn is **one POST whose response body streams SSE** (`lib/assistant/`): create
a conversation once (`POST /assistant/sessions?preset=browse`), then post each
message and fold the streamed `TurnEvent`s into the message list. Nothing is held
open between turns, and cancelling is aborting the fetch — the backend notices its
next write fail and stops before spending another model call.

The conversation id lives in `storage.local`, so closing the panel and reopening
it resumes; the transcript is replayed from the server through the same reducer a
live turn folds through. A conversation deleted from the web starts a fresh one
silently.

Read-a-page flow — note that the panel is not the one deciding:

```
hire's agent --read_page--> relay --> panel
panel --GET_PAGE_SNAPSHOT--> background --(active tab)--> content
content --PAGE_SNAPSHOT--> background --> panel --> relay --> the agent, mid-turn
```

## Conventions

- **`protocol.ts` is the in-extension contract** — `RuntimeMessage`
  (panel <-> background <-> content, discriminated by `kind`). Neither the chat's
  wire nor the browser-tool wire is here: they are `lib/assistant/wire.ts` and
  `lib/tools/wire.ts`, each mirroring a contract hire owns.
- **The agent's reading is bounded, and visible.** `read_page` refuses any tab that
  is not `http(s)` (`lib/tools/readable.ts`), decided from the url before the page
  is read — this extension is the only side that sees a url before scraping it. The
  panel then names the page each read touched, minus query and fragment, which is
  where session tokens live. That display lives in `lib/assistant/pageRead.ts`
  rather than in `tool-formatters.ts`, precisely because the latter is a verbatim
  port and `read_current_page` cannot occur in the web app.
- **`lib/assistant/` mirrors the freehire web assistant** (`web/src/lib/assistant`
  in the hire repo). `sse`, `wire`, `chat`, `deck` and `tool-formatters` are
  verbatim ports — keep them aligned. Exactly two files diverge, and they say so
  at the top: `api.ts`/`client.ts` (absolute origin + Bearer, since extension code
  has no cookie) and `jobCache.ts` (reads the token the web's cookie made
  implicit).
- **Test the logic, not the transport.** `scraper`, `form`, `protocol`, the
  assistant's reducers and its API clients are tested (vitest); the chrome message
  plumbing, the live socket and `storage.local` helpers are thin glue.
- **TypeScript stays on 5.x** — svelte-check does not yet support the native
  `typescript@7` (tsgo).

## Commands

```bash
# hire must be reachable at WXT_HIRE_ORIGIN (default: the local SPA at :5173,
# which proxies /api). The signed-in account needs the assistant's restricted
# rollout — moderator or beta_tester — or every turn is a 403.

cd extension && npm install          # runs `wxt prepare` (generates .wxt/)
cd extension && npm run dev          # dev build with HMR
cd extension && npm run build        # production build -> .output/chrome-mv3
                                     # targets freehire.me
                                     # (extension/.env.production); dev keeps
                                     # the localhost default
cd extension && npm test             # vitest: lib/**/*.test.ts
cd extension && npm run check        # svelte-check
```

Load unpacked in Chrome: `chrome://extensions` → Developer mode → **Load
unpacked** → `extension/.output/chrome-mv3`. Click the toolbar icon to open the
panel.
