# The panel talks to freehire's own assistant

Supersedes `2026-07-24-panel-roy-chat-design.md`. Roy is removed, not migrated.

## Why

The side panel's chat is the last thing in this extension that still talks to
Roy. Everything else already reaches hire directly: the browser-tool relay
(`/api/v1/tools/ws`), the agentic autofill (`/me/autofill/run`), the job and
match reads. hire has since grown its own in-process assistant
(`internal/assistant`) — the one the web app runs at `/my/assistant` — with the
tools this panel wants and none of Roy's control protocol.

Keeping two agent runtimes means every new tool is written twice and the panel's
chat drifts from the web's. So the panel moves onto the same assistant, and
`agent.freehire.me` leaves this repository entirely.

The feature is behind hire's restricted rollout and has no users, so this breaks
whatever it needs to break rather than preserving a wire nobody depends on.

## What the panel gains

A page-aware agent. On the web the assistant can search, judge and track
vacancies but cannot see what the candidate is looking at. In the panel it can:
a new `read_current_page` tool reaches the open tab through the relay this
extension already serves. The manual "Read page" button goes away — the agent
decides when to look, the way it already decides when to search.

## Architecture

```
panel  ──POST /api/v1/assistant/sessions/:id/messages──►  hire
       ◄──────────── SSE: the turn, frame by frame ─────
                                │
                                ├─ tool read_current_page
                                │    └─ browsertools.Hub ──► panel's relay socket
                                │         └─ background ──► content script
                                │              └─ PageSnapshot
                                └─ tools search_jobs, get_profile, present_jobs…
```

One POST per turn. No socket held between turns, no `attach`, no input lease.
Cancelling is aborting the fetch: the backend's next write fails and it stops the
loop before spending another model call.

The relay socket stays exactly as it is — the panel already holds it for
autofill, and `read_current_page` is one more primitive over the same wire.

## Backend changes (hire)

### 1. The assistant accepts a Bearer session JWT

`internal/handler/assistant.go` mounts every assistant route under `mw.cookie`
(cookie-only). An extension cannot send hire's httpOnly cookie cross-origin, but
`auth.resolveCredential` already authenticates a session JWT presented as
`Authorization: Bearer` — which is how this extension calls `/me/autofill/run`
today.

The five assistant routes move to `mw.key` (`RequireAuthOrKey`). That also admits
a full-scope API key, which is correct: a key holder can already drive every
other full-scope route.

### 2. A third preset: `browse`

`PresetBrowse` joins `PresetChat` and `PresetTailor`. As with the other two, the
preset selects the system prompt and the tool set and nothing else.

- **Prompt.** The chat prompt plus: the candidate is standing on a page, so look
  at it before guessing what they mean; the panel is a narrow column, so keep
  answers short.
- **Tools.** The discovery and tracking tools every session gets, plus
  `read_current_page`.

`read_current_page` is deliberately *not* added to `PresetChat`. A web session
with no panel open would carry a tool that always fails, and a tool that always
fails is noise in the model's context.

### 3. The `read_current_page` tool

New file `internal/handler/assistant_page_tools.go`, following the registry's
own recipe: a name, a description the model reads, a schema (no arguments), and a
`Run` that calls the same service the HTTP surface would.

```go
caller := h.browserTools.NewCaller(userID)
defer caller.Close()
raw, err := caller.Call(ctx, "read_page", nil)
```

It returns the snapshot as structured data — `url`, `title`, `headline`, `text`.

`assistantHandlers` gains a `*browsertools.Hub` field, wired in
`newAssistantHandlers` from the hub the API already owns.

**No browser attached** is the common case (a web session, or a panel that is
closed) and it is not a turn failure. The relay answers an unreachable extension
with `{id, error}` rather than hanging the caller, and the tool turns that into
`{"error": "no browser attached — ask the user to open the freehire side panel"}`.
The model reads that and tells the candidate what to do, inside the same turn.

**Known limitation, accepted.** A channel has one `RoleHarness` end and the last
connection wins. An autofill run and a turn calling `read_current_page` are two
harnesses on one channel and would evict each other. A person clicks "Autofill"
or sends a message, not both at once, so this is not worth solving yet. The seam
is `Hub`: several harnesses, each addressed by the id it is waiting on.

## Extension changes

### Transport: `lib/roy/` → `lib/assistant/`

`lib/roy/` is deleted — client, session bootstrap, wire, chat reducer and their
tests. `lib/assistant/` is ported from `web/src/lib/assistant/` in the hire repo:

| file | ported from the web | divergence |
| --- | --- | --- |
| `sse.ts` | verbatim | — |
| `wire.ts` | verbatim | — |
| `chat.ts` | verbatim | — |
| `deck.ts`, `jobCache.ts` | verbatim | — |
| `api.ts`, `client.ts` | ported | absolute `HIRE_ORIGIN`; `Authorization: Bearer` instead of `credentials: 'include'` |

One divergence, in one place, instead of three protocol layers. The convention
this repo already holds — "`lib/roy/` mirrors the web assistant, keep them
aligned" — survives the rename and gets easier to honour.

### `App.svelte`

Gone: `client`, `sessionId`-as-socket-state, `attached`, `inputAcquired`,
`pendingEcho`, `frameUnsub`, `resetRoy`, `endTurn`, `ensureConnected`. A turn is

```ts
const turn = sendTurn(sessionId, text, onEvent);
```

and cancelling it is `turn.cancel()`.

The optimistic user bubble and the echo suppression go with them: hire emits
`user_prompt` as the turn's first frame, before the first model call, so the
reducer paints it as fast as the optimistic path did.

**Session persistence.** `sessionId` lives in `chrome.storage.local`. On mount the
panel replays the transcript through `getSession` → `eventsFromTranscript` → the
same reducer a live turn folds through. Close the panel, reopen it, the
conversation is still there. A `SessionNotFound` (deleted from the web) starts a
fresh one rather than showing an error.

No session rail: one active conversation and a "New chat" button. A rail is a
web-sized affordance, and the panel is 400px.

Sessions created here are visible in the web's rail at `/my/assistant` — a
consequence of `ListSessions` not filtering by preset, and a good one: a
conversation started on a Greenhouse posting continues at the desk.

### The relay gains a `read_page` primitive

`lib/tools/executor.ts` gets a third case beside `read_form` and `fill_simple`,
and `PageBridge` a `readPage()`. It is glue: the `GET_PAGE_SNAPSHOT` runtime
message and `scraper.ts` already produce a `PageSnapshot`, and `protocol.ts` needs
no new message.

### Chat UI

- **"Read page" is removed.** It was the manual stand-in for what the agent now
  does on its own.
- **Tool activity renders.** `ToolGroupList.svelte` and `tool-formatters.ts` are
  ported and tightened for a narrow column.
- **`present_jobs` renders as cards.** `JobDeck`/`JobDeckCard` are ported, styled
  to sit beside the existing `MatchCard`. Without them the discovery tools are
  useless here: the assistant's prompt forbids writing a vacancy into prose, so a
  panel that cannot draw a card is a panel where search returns nothing visible.

`MatchCard` and "add this page to freehire" are untouched. They are deterministic
features, not chat.

## What is not touched

`lib/tools/` (beyond the new primitive), `lib/form.ts`, `lib/combobox.ts`,
`lib/auth.ts`, `lib/freehire.ts`, the background relay, the content script, and
every part of autofill. None of it went through Roy.

## Roy's removal

`ROY_ORIGIN` from `env.d.ts` and `.env.production`; `royWsUrl`; every mention in
`AGENTS.md` and `README.md`. After this the extension has no idea
`agent.freehire.me` exists.

Two stale artefacts describe the world this replaces and are removed with it: the
unarchived `openspec/changes/connect-panel-to-roy/`, and
`docs/superpowers/specs/2026-07-24-panel-roy-chat-design.md`, whose header now
points here.

## Testing

New logic, tested:

- `read_page` dispatch in `executor.ts`, over a fake `PageBridge` (vitest).
- `read_current_page` in Go, over a fake extension end of the hub — the shape
  `internal/browsertools/caller_test.go` already uses. Both paths: a snapshot, and
  no browser attached.
- The widened auth gate, in `assistant_integration_test.go`: a Bearer session JWT
  is admitted, an unauthenticated request is still 401, a non-rollout user is
  still 403.
- The `browse` preset registers `read_current_page` and `chat` does not.

Ported files arrive with the web's tests (`sse`, `chat`, `deck`, `wire`).

Not tested, by the repo's own convention: the chrome message plumbing and the
live SSE stream. Those are thin glue over logic that is tested.
