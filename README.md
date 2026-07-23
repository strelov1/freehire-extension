# freehire-extension

A browser extension that puts a job-application **agent in a side panel** —
like the Claude/Gemini side bar — with access to whatever page you're on. The
agent's brain lives behind a local server; eventually that server bridges to the
existing [`freehire-agent`](../freehire-agent) (Roy). This repo is the browser
surface plus the server seam.

**Status: scaffolding.** The wiring is real end-to-end; the "agent" is a mock
echo. No real agent, auth, profile context, or form-filling yet — those are
follow-up specs (tracked in OpenSpec from the next one on).

## Layout

```
extension/            WXT + Svelte MV3 extension
  entrypoints/
    background.ts     service worker: opens the panel, relays panel <-> content
    content.ts        injected everywhere; reads the page into a PageSnapshot
    sidepanel/        Svelte chat app (owns the WebSocket to the server)
  lib/
    protocol.ts       single source of truth for every message shape
    scraper.ts        DOM -> PageSnapshot (pure, tested)
server/               Rust WebSocket stub (axum); mock replies, seam for Roy
```

## Architecture

Three moving parts, one contract (`extension/lib/protocol.ts`):

- **Side panel** (Svelte) owns the WebSocket. It's the only context that stays
  alive while open — unlike the MV3 service worker, which Chrome kills when idle,
  so it can't hold a durable socket.
- **Content script** reads the live DOM on request. It holds no state.
- **Background** is a thin relay: the panel can't message a content script
  directly, so background forwards a snapshot request to the active tab.

Read-a-page flow:

```
panel --GET_PAGE_SNAPSHOT--> background --(active tab)--> content
content --PAGE_SNAPSHOT--> background --> panel --page_context(ws)--> server
server --assistant_message(ws)--> panel
```

The **WebSocket half** of the contract (`ClientEvent` / `ServerEvent`) is
mirrored in the Rust server via serde. The **agent seam** is `mock_reply` in
`server/src/main.rs` — replace its body to talk to Roy; nothing else moves.

## Develop

```bash
# Rust WS server (ws://localhost:3899/ws)
cd server && cargo run

# Extension dev build with HMR (loads chrome-mv3 into a dev profile)
cd extension && npm install && npm run dev

# Or a production build to load unpacked from extension/.output/chrome-mv3
cd extension && npm run build
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked**
→ pick `extension/.output/chrome-mv3`. Click the toolbar icon to open the panel.

## Test

```bash
cd extension && npm test     # vitest: scraper + protocol
cd server && cargo test      # mock_reply
```

## Definition of done (this scaffold)

Load the extension → toolbar icon opens the side panel → chat connects to the
server (`connected`) → **Read page** on any site shows its heading → sending a
message returns an echo from the server.
