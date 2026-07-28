# freehire-extension

A browser extension that puts [freehire](https://freehire.me)'s job-search agent
in a side panel — a Claude/Gemini-style side bar with access to whatever page
you're on.

The agent is freehire's own, running inside its API. There is no separate agent
service and nothing to install alongside this: sign in with freehire, and the
panel holds a conversation with the same assistant the web app runs — except that
this one can see the page in front of you.

What it does today:

- **Chat** with the assistant about the page you're on. It reads the page itself
  when your question needs it, and can search, judge and track vacancies.
- **Match card** — a deterministic skill-coverage read of the posting against your
  profile, on freehire's own job pages and on any other posting it can recognise.
- **Add to freehire** — hand a posting freehire doesn't have to the catalogue.
- **Autofill** — fill an application form from your profile, agent-driven, across
  the page's frames.

## Layout

```
extension/            WXT + Svelte MV3 extension
  entrypoints/
    background.ts     service worker: opens the panel, relays panel <-> content
    content.ts        injected everywhere; reads the page and drives its forms
    sidepanel/        the Svelte panel: chat, match card, job cards, autofill
  lib/
    assistant/        the chat's transport, ported from freehire's web app
    tools/            the browser-tool wire freehire drives this browser through
    auth.ts           "Sign in with freehire" + token storage
    freehire.ts       hire API reads (job, match, intake, autofill profile)
    scraper.ts        DOM -> PageSnapshot (pure, tested)
    form.ts           form observe/map/act for autofill (pure, tested)
```

## Architecture

Everything talks to one origin — freehire's API. Two channels:

- **HTTP.** A conversation turn is a single POST whose response body streams the
  turn as SSE. Nothing is held open between turns; stopping a turn is aborting
  that fetch.
- **A WebSocket to the browser-tool relay.** freehire's agent drives this browser
  through it — reading the page for the chat, reading and filling forms for
  autofill. The panel holds this socket because it is the only context that stays
  alive; the MV3 service worker is killed when idle.

Both carry the session JWT the connect flow minted: an `Authorization: Bearer`
header on HTTP, the subprotocol slot on the WebSocket (a browser cannot set
headers on `new WebSocket`).

Reading the page, end to end:

```
freehire's agent --read_page--> relay --> panel --> background --> content script
content script --PageSnapshot--> ... --> the agent, mid-turn
```

## Develop

```bash
cd extension && npm install    # runs `wxt prepare`
cd extension && npm run dev     # dev build with HMR
cd extension && npm run build   # production build -> .output/chrome-mv3
cd extension && npm test        # vitest
cd extension && npm run check   # svelte-check
```

Development builds talk to `http://localhost:5173` (the SPA origin, which proxies
`/api`); production builds target `freehire.me` (`extension/.env.production`).

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked**
→ pick `extension/.output/chrome-mv3`. Click the toolbar icon to open the panel.

The assistant is behind freehire's restricted rollout, so the account you sign in
with needs to be in it.
