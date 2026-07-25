<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import { type RuntimeMessage, type PageSnapshot } from '../../lib/protocol';
  import { RoyClient, type ServerError } from '../../lib/roy/client';
  import { createSession, royWsUrl } from '../../lib/roy/session';
  import { initChat, reduceTurnEvent, type ChatState } from '../../lib/roy/chat';
  import type { TurnEvent } from '../../lib/roy/wire';
  import { signIn, signOut, getToken, fetchMe, type HireUser } from '../../lib/auth';
  import {
    freehireSlugFromUrl,
    findJob,
    getJob,
    getMatch,
    getMatchText,
    getAutofillProfile,
    runAgentAutofill,
    resolveJob,
    resolveNotice,
    type FreehireJob,
    type JobMatch,
    type AutofillProfile,
  } from '../../lib/freehire';
  import { planLabelFills, looksLikeApplication, scopeToApplication } from '../../lib/form';
  import { ToolChannel } from '../../lib/tools/client';
  import { activeTabPage } from '../../lib/tools/page';
  import MatchCard from './MatchCard.svelte';

  let chat = $state<ChatState>(initChat());
  // Local action feedback (autofill results, errors) — not part of a Roy turn.
  let notices = $state<string[]>([]);
  let draft = $state('');
  let connected = $state(false);
  let sending = $state(false);
  let chatError = $state('');

  // Roy transport — plain (non-reactive) refs; nothing here is rendered directly.
  let client: RoyClient | null = null;
  let sessionId: string | null = null;
  let attached = false;
  let inputAcquired = false;
  // The optimistic user message we already painted; suppress Roy's echoed
  // `user_prompt` frame that matches it (see onFrame).
  let pendingEcho: string | null = null;
  let frameUnsub: (() => void) | null = null;

  let user = $state<HireUser | null>(null);
  let authBusy = $state(false);
  let authError = $state('');

  // The browser-tool wire: while the panel is open this holds the socket the
  // agent drives this browser through. It lives here rather than in the service
  // worker because only the panel stays alive.
  const tools = new ToolChannel(activeTabPage);

  type MatchStatus = 'idle' | 'loading' | 'ready' | 'error' | 'empty';
  let matchStatus = $state<MatchStatus>('idle');
  let matchJob = $state<FreehireJob | null>(null);
  let match = $state<JobMatch | null>(null);
  let matchError = $state('');

  onMount(() => {
    // The Roy connection + session are created lazily on the first message
    // (see dispatch → ensureConnected), so an idle panel spawns no agent.
    void restoreSession();

    // Re-run the match when the user switches tabs or a page finishes loading,
    // so the card tracks whatever job page is in front — like the reference.
    const refresh = () => {
      if (user) void loadMatch();
    };
    browser.tabs.onActivated.addListener(refresh);
    const onUpdated = (_id: number, info: { status?: string }) => {
      if (info.status === 'complete') refresh();
    };
    browser.tabs.onUpdated.addListener(onUpdated);

    return () => {
      frameUnsub?.();
      client?.close();
      tools.stop();
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  });

  async function restoreSession() {
    const token = await getToken();
    if (token) {
      user = await fetchMe(token);
      if (user) {
        tools.start(token);
        void loadMatch();
      }
    }
  }

  async function loadCatalog(slug: string, token: string) {
    const [job, m] = await Promise.all([getJob(slug, token), getMatch(slug, token)]);
    matchJob = job;
    match = m;
  }

  async function loadMatch() {
    const token = await getToken();
    if (!token) {
      matchStatus = 'empty';
      matchJob = null;
      match = null;
      return;
    }
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? '';

    matchStatus = 'loading';
    matchError = '';
    try {
      // Freehire's own job page → curated slug directly.
      const directSlug = freehireSlugFromUrl(url);
      if (directSlug) {
        await loadCatalog(directSlug, token);
        matchStatus = 'ready';
        return;
      }

      // Any other page: recognise it as a catalog job from its URL (curated
      // card), else read the page and match against the scraped posting text.
      const catalogSlug = await findJob(url, token);
      const snap = catalogSlug ? null : await readSnapshot();
      const headline = snap?.headline || snap?.title || '';

      if (catalogSlug) {
        await loadCatalog(catalogSlug, token);
      } else if (snap?.text) {
        const t = headline || 'This page';
        match = await getMatchText(t, snap.text, token);
        matchJob = { public_slug: '', title: t, company: hostOf(url), location: '' };
      } else {
        matchStatus = 'empty';
        return;
      }
      matchStatus = 'ready';
    } catch (err) {
      matchError = err instanceof Error ? err.message : 'Could not load match';
      matchStatus = 'error';
    }
  }

  // The page resolved to no catalog posting: either nothing to show, or the ad-hoc text
  // match, which carries no slug. That is when freehire has something to gain from being
  // handed the page.
  let unknownPage = $derived(
    matchStatus === 'empty' || (matchStatus === 'ready' && matchJob?.public_slug === ''),
  );
  let contributing = $state(false);

  /**
   * Hands the current page to freehire. The server imports the vacancy when a link-source
   * adapter can read the page and queues the link for a maintainer when none can; either
   * way the panel says what happened, and a resolved slug re-runs the match so the curated
   * card replaces the ad-hoc one.
   */
  async function contributePage() {
    const token = await getToken();
    if (!token || contributing) return;
    contributing = true;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? '';
      if (!url) {
        notices.push('No page to add.');
        return;
      }
      const resolved = await resolveJob(url, token);
      notices.push(resolveNotice(resolved.status));
      if (resolved.public_slug) await loadMatch();
    } catch (err) {
      notices.push(`Could not add this page: ${err instanceof Error ? err.message : 'error'}`);
    } finally {
      contributing = false;
    }
  }

  async function readSnapshot(retries = 4): Promise<PageSnapshot | null> {
    for (let i = 0; i < retries; i++) {
      try {
        const reply = (await browser.runtime.sendMessage({
          kind: 'GET_PAGE_SNAPSHOT',
        } satisfies RuntimeMessage)) as RuntimeMessage | undefined;
        if (reply?.kind === 'PAGE_SNAPSHOT' && reply.snapshot.text) {
          return reply.snapshot;
        }
      } catch {
        // Content script not ready yet (e.g. just after an extension reload).
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  }

  function hostOf(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  async function handleSignIn() {
    authBusy = true;
    authError = '';
    try {
      const token = await signIn();
      user = await fetchMe(token);
      if (!user) authError = 'Signed in, but could not load your account.';
      else {
        tools.start(token);
        void loadMatch();
      }
    } catch (err) {
      authError = err instanceof Error ? err.message : 'Sign-in failed';
    } finally {
      authBusy = false;
    }
  }

  async function handleSignOut() {
    await signOut();
    user = null;
    // Detach the wire too: it is authenticated as the user who just left.
    tools.stop();
    // Drop the authenticated socket + session so a later sign-in never reuses
    // the previous user's Roy session, and clear their conversation.
    resetRoy();
    chat = initChat();
    notices = [];
    chatError = '';
  }

  // Connect to Roy and attach to a (lazily created) session. Idempotent: safe to
  // call before every dispatch.
  //
  // The session comes first, and not only because the socket has nothing to
  // attach to without it: `POST /sessions` is plain HTTP, so a rejected token is
  // reported as "auth required (HTTP 401)". The WebSocket handshake cannot say
  // that — a browser hides the handshake's response code from script — so
  // connecting first turned every auth failure into an opaque "failed to
  // connect to wss://…".
  async function ensureConnected(token: string) {
    if (!sessionId) sessionId = await createSession(token);
    if (!client) {
      client = new RoyClient();
      client.onStatus((s) => {
        connected = s === 'open';
        // A dropped socket never delivers a terminal `result`, and a `send` is
        // fire-and-forget (nothing to reject), so unstick the turn and reset the
        // transport. No reconnect — the next message starts a fresh session.
        if (s === 'closed' || s === 'error') {
          if (sending) chatError = 'Connection to the agent was lost. Try again.';
          resetRoy();
        }
      });
      // A turn that ends with an `error` event (agent crash, tool failure)
      // instead of a terminal `result` would otherwise hang the turn forever.
      client.onError((e: ServerError) => {
        chatError = `The agent hit an error: ${e.message}`;
        endTurn();
      });
      await client.connect(royWsUrl(), token);
    }
    if (!attached) {
      // Subscribe BEFORE attaching so the `from_seq: 0` replay frames are caught.
      // Guard against re-subscribing when a prior attach failed but left the sub
      // in place — a second callback would double every frame.
      if (!frameUnsub) {
        frameUnsub = client.subscribeFrames(sessionId, (entry) => onFrame(entry.event));
      }
      await client.call({ op: 'attach', session: sessionId, from_seq: 0 }, 'attached');
      attached = true;
    }
  }

  // Tear down the Roy transport. Used on sign-out and on a dropped socket so a
  // later send reconnects cleanly (refs are nulled before close() to avoid the
  // onclose handler re-entering this).
  function resetRoy() {
    const c = client;
    frameUnsub?.();
    frameUnsub = null;
    client = null;
    sessionId = null;
    attached = false;
    inputAcquired = false;
    sending = false;
    connected = false;
    c?.close();
  }

  function onFrame(event: TurnEvent) {
    // Suppress the echoed user_prompt for a message we already showed optimistically.
    if (event.type === 'user_prompt' && pendingEcho !== null && event.text === pendingEcho) {
      pendingEcho = null;
      return;
    }
    chat = reduceTurnEvent(chat, event);
    if (event.type === 'result') endTurn();
  }

  function endTurn() {
    sending = false;
    if (client && sessionId && inputAcquired) {
      inputAcquired = false;
      void client
        .call({ op: 'release_input', session: sessionId }, 'input_released')
        .catch(() => {});
    }
  }

  // Acquire the input lease, paint the user message optimistically (`displayText`
  // may be a short label while `sendText` carries fuller context), and fire the
  // prompt. `pendingEcho` is the SENT text so Roy's echoed frame is suppressed.
  async function dispatch(sendText: string, displayText = sendText) {
    if (sending) return;
    // Claim the turn synchronously — before the first await — so a second action
    // during `getToken()` queues out via the guard instead of double-dispatching.
    sending = true;
    chatError = '';
    const token = await getToken();
    if (!token) {
      sending = false;
      chatError = 'Sign in to chat with the agent.';
      return;
    }
    try {
      await ensureConnected(token);
      const id = sessionId!;
      if (!inputAcquired) {
        const acquired = await client!.call({ op: 'acquire_input', session: id }, 'input_acquired');
        if (!acquired.acquired) {
          sending = false;
          chatError = 'The agent is busy (open in another tab?). Try again in a moment.';
          return;
        }
        inputAcquired = true;
      }
      pendingEcho = sendText;
      chat = reduceTurnEvent(chat, { type: 'user_prompt', text: displayText });
      client!.fire({ op: 'send', session: id, text: sendText });
    } catch (err) {
      sending = false;
      inputAcquired = false;
      chatError = err instanceof Error ? err.message : 'Could not reach the agent.';
    }
  }

  function sendMessage() {
    const text = draft.trim();
    if (!text || sending) return;
    draft = '';
    void dispatch(text);
  }

  let autofilling = $state(false);

  function profileToValues(p: AutofillProfile): Record<string, string> {
    return {
      fullName: p.full_name,
      firstName: p.first_name,
      lastName: p.last_name,
      email: p.email,
      phone: p.phone,
      city: p.location,
      linkedin: p.linkedin,
      github: p.github,
      portfolio: p.portfolio,
    };
  }

  /**
   * Autofill, agent-first: freehire's agent reads the form through the wire,
   * maps the profile onto it, and fills what it can justify. The deterministic
   * filler stays as the fallback until the agent path has proven itself — it
   * only knows a fixed set of labels, but it needs nothing but this browser.
   */
  /**
   * Names the first few labels and counts the rest. A real ATS form leaves
   * dozens of fields untouched (Greenhouse alone contributes a checkbox per
   * country), and a notice that lists them all is one the user cannot read.
   */
  function nameSome(labels: string[], shown = 5): string {
    const trimmed = labels.map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
    if (trimmed.length <= shown) return trimmed.join(', ');
    return `${trimmed.slice(0, shown).join(', ')} and ${trimmed.length - shown} more`;
  }

  async function autofill() {
    const token = await getToken();
    if (!token || autofilling) return;
    autofilling = true;
    try {
      const report = await runAgentAutofill(token);
      const filled = report.filled.length;
      notices.push(
        filled > 0
          ? `✓ Autofilled ${filled} field${filled === 1 ? '' : 's'} — review before submitting.`
          : 'The agent found nothing on this form it could fill from your profile.',
      );
      if (report.deferred.length > 0) {
        notices.push(`Not fillable yet (custom dropdowns): ${nameSome(report.deferred)}.`);
      }
      if (report.unmapped.length > 0) {
        notices.push(`Left for you: ${nameSome(report.unmapped)}.`);
      }
    } catch (err) {
      // The server's own sentence, not just the status: /me/autofill/run answers
      // 409 for three unrelated states, and only that sentence says which.
      notices.push(
        `Agent autofill unavailable: ${err instanceof Error ? err.message : 'error'} — using the basic filler.`,
      );
      await deterministicAutofill(token);
    } finally {
      autofilling = false;
    }
  }

  /**
   * The fallback filler, over the same frame-aware primitives the agent drives:
   * an apply form is routinely served from an ATS iframe, and a careers page
   * carrying any other iframe would otherwise be answered by whichever frame
   * replied first. Addressing questions by label rather than by position also
   * keeps the read and the write on the same question when a form re-renders
   * between them.
   */
  /**
   * The fill the user has been offered but not yet confirmed, because the page
   * does not look like it is showing an application form. Held so "Fill anyway"
   * runs the same pass rather than re-reading a page that may have moved on.
   */
  let overrideFill = $state<(() => Promise<void>) | null>(null);

  async function runOverrideFill() {
    const run = overrideFill;
    if (!run || autofilling) return;
    overrideFill = null;
    autofilling = true;
    try {
      await run();
    } finally {
      autofilling = false;
    }
  }

  async function deterministicAutofill(token: string, force = false) {
    try {
      const formReply = (await browser.runtime.sendMessage({
        kind: 'GET_FRAMED_FORM',
      } satisfies RuntimeMessage)) as RuntimeMessage | undefined;
      if (formReply?.kind !== 'FRAMED_FORM' || formReply.fields.length === 0) {
        notices.push('No form fields found on this page.');
        return;
      }

      // A careers page keeps the application behind an "Apply" button and shows a
      // job-alert signup meanwhile; filling that one silently is worse than
      // declining, so the user is told and can insist.
      if (!force && !looksLikeApplication(formReply.uploads)) {
        notices.push(
          `This doesn't look like the application form — ${formReply.fields.length} field${
            formReply.fields.length === 1 ? '' : 's'
          } are showing and none of them takes a CV. Open the application on the page, then try again.`,
        );
        overrideFill = () => deterministicAutofill(token, true);
        return;
      }
      overrideFill = null;

      // One form, not every question on the page: an application and a job-alert
      // signup each have their own "Email".
      const scoped = scopeToApplication(formReply.fields, formReply.uploads);
      const fills = planLabelFills(scoped, profileToValues(await getAutofillProfile(token)));
      if (fills.length === 0) {
        notices.push('Nothing matched your profile on this form.');
        return;
      }
      const applied = (await browser.runtime.sendMessage({
        kind: 'FILL_BY_LABEL',
        fills,
      } satisfies RuntimeMessage)) as RuntimeMessage | undefined;
      const outcomes = applied?.kind === 'FILL_OUTCOMES' ? applied.outcomes : [];
      const n = outcomes.filter((o) => o.status === 'filled').length;
      notices.push(`✓ Autofilled ${n} field${n === 1 ? '' : 's'} — review before submitting.`);

      // A custom-widget combobox commits whatever its own listbox highlights, so
      // the simple filler declines it rather than writing a wrong value.
      const deferred = outcomes.filter((o) => o.status === 'deferred_combobox').map((o) => o.label);
      if (deferred.length > 0) {
        notices.push(`Not fillable yet (custom dropdowns): ${nameSome(deferred)}.`);
      }
    } catch (err) {
      notices.push(`Autofill failed: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  async function readPage() {
    const reply = (await browser.runtime.sendMessage({
      kind: 'GET_PAGE_SNAPSHOT',
    } satisfies RuntimeMessage)) as RuntimeMessage | undefined;

    if (reply?.kind !== 'PAGE_SNAPSHOT') return;
    const { snapshot } = reply;
    const headline = snapshot.headline || snapshot.title || snapshot.url || 'this page';
    // Send the page to Roy as context, but paint a compact bubble (not the full
    // page text) for the optimistic user message.
    const context = `Here is the page I'm looking at:\n\nTitle: ${snapshot.title}\nURL: ${snapshot.url}\n\n${snapshot.text}`;
    void dispatch(context, `📄 Read page: ${headline}`);
  }
</script>

<div class="app">
  <header>
    <div class="top">
      <strong>freehire</strong>
      <span class="status" class:online={connected}>
        {connected ? 'connected' : user ? 'ready' : 'offline'}
      </span>
    </div>
    <div class="auth">
      {#if user}
        <span class="who">Signed in as <b>{user.email}</b></span>
        <button class="link" onclick={handleSignOut}>Sign out</button>
      {:else}
        <button class="signin" onclick={handleSignIn} disabled={authBusy}>
          {authBusy ? 'Signing in…' : 'Sign in with freehire'}
        </button>
      {/if}
    </div>
    {#if authError}
      <div class="auth-error">{authError}</div>
    {/if}
  </header>

  {#if user}
    {#if matchStatus === 'ready' && matchJob && match}
      <MatchCard job={matchJob} {match} />
    {:else if matchStatus === 'loading'}
      <p class="match-hint">Analyzing match…</p>
    {:else if matchStatus === 'error'}
      <p class="match-hint err">
        Match unavailable: {matchError}
        <button class="link" onclick={loadMatch}>Retry</button>
      </p>
    {:else if matchStatus === 'empty'}
      <p class="match-hint">
        Open a job posting to see your match.
        <button class="link" onclick={loadMatch}>Refresh</button>
      </p>
    {/if}
    {#if unknownPage}
      <p class="match-hint">
        freehire doesn't have this posting.
        <button class="link" onclick={contributePage} disabled={contributing}>
          {contributing ? 'Adding…' : 'Add to freehire'}
        </button>
      </p>
    {/if}
  {/if}

  <div class="messages">
    {#each chat.messages as message}
      <div class="message {message.role}" class:errored={message.errored}>
        {message.text}{#if message.streaming && !message.text}<span class="dots">…</span>{/if}
      </div>
    {/each}
    {#each notices as notice}
      <div class="message system">{notice}</div>
    {/each}
    {#if overrideFill}
      <div class="message system">
        <button class="link" onclick={runOverrideFill} disabled={autofilling}>Fill it anyway</button>
      </div>
    {/if}
    {#if chatError}
      <div class="message system err">{chatError}</div>
    {/if}
    {#if chat.messages.length === 0 && notices.length === 0}
      <p class="empty">
        {user ? 'Read the current page or say something to start.' : 'Sign in to chat with the agent.'}
      </p>
    {/if}
  </div>

  <div class="composer">
    {#if user}
      <button class="ghost" onclick={autofill} disabled={autofilling}>
        {autofilling ? 'Filling…' : 'Autofill'}
      </button>
    {/if}
    <button class="ghost" onclick={readPage} disabled={!user || sending}>Read page</button>
    <input
      placeholder={user ? 'Message the agent…' : 'Sign in to chat'}
      bind:value={draft}
      disabled={!user || sending}
      onkeydown={(e) => e.key === 'Enter' && sendMessage()}
    />
    <button onclick={sendMessage} disabled={!user || sending}>Send</button>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, sans-serif;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-size: 14px;
  }

  header {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid #e5e5e5;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .status {
    font-size: 12px;
    color: #999;
  }

  .status.online {
    color: #1a8917;
  }

  .auth {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
  }

  .who {
    color: #555;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .signin {
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    background: #2563eb;
    color: #fff;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }

  .signin:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .link {
    border: none;
    background: none;
    color: #2563eb;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    padding: 0;
  }

  .auth-error {
    font-size: 12px;
    color: #b42318;
  }

  .match-hint {
    font-size: 12px;
    color: #999;
    margin: 12px;
  }

  .match-hint.err {
    color: #b42318;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .empty {
    color: #aaa;
    text-align: center;
    margin-top: 40px;
  }

  .message {
    padding: 8px 10px;
    border-radius: 8px;
    max-width: 85%;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message.user {
    align-self: flex-end;
    background: #2563eb;
    color: #fff;
  }

  .message.assistant {
    align-self: flex-start;
    background: #f1f1f1;
  }

  .message.system {
    align-self: center;
    background: #fff7d6;
    font-size: 12px;
    color: #7a6a1f;
  }

  .message.system.err {
    background: #fdeceb;
    color: #b42318;
  }

  .message.assistant.errored {
    border: 1px solid #f3b0aa;
  }

  .dots {
    opacity: 0.5;
  }

  .composer {
    display: flex;
    gap: 6px;
    padding: 10px;
    border-top: 1px solid #e5e5e5;
  }

  .composer input {
    flex: 1;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font: inherit;
  }

  .composer button {
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    background: #2563eb;
    color: #fff;
    cursor: pointer;
  }

  .composer button.ghost {
    background: #f1f1f1;
    color: #333;
  }

  .composer button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
