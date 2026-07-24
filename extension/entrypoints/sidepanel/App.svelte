<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import {
    parseServerEvent,
    type ClientEvent,
    type RuntimeMessage,
    type PageSnapshot,
  } from '../../lib/protocol';
  import { signIn, signOut, getToken, fetchMe, type HireUser } from '../../lib/auth';
  import {
    freehireSlugFromUrl,
    guessJobIdentity,
    findJob,
    getJob,
    getMatch,
    getMatchText,
    getAutofillProfile,
    type FreehireJob,
    type JobMatch,
    type AutofillProfile,
  } from '../../lib/freehire';
  import { matchFieldKey } from '../../lib/form';
  import MatchCard from './MatchCard.svelte';

  const SERVER_URL = 'ws://localhost:3899/ws';

  type ChatMessage = { role: 'user' | 'assistant' | 'system'; text: string };

  let messages = $state<ChatMessage[]>([]);
  let draft = $state('');
  let connected = $state(false);
  let socket: WebSocket | null = null;

  let user = $state<HireUser | null>(null);
  let authBusy = $state(false);
  let authError = $state('');

  type MatchStatus = 'idle' | 'loading' | 'ready' | 'error' | 'empty';
  let matchStatus = $state<MatchStatus>('idle');
  let matchJob = $state<FreehireJob | null>(null);
  let match = $state<JobMatch | null>(null);
  let matchError = $state('');

  onMount(() => {
    socket = new WebSocket(SERVER_URL);
    socket.addEventListener('open', () => (connected = true));
    socket.addEventListener('close', () => (connected = false));
    socket.addEventListener('message', (e) => {
      const event = parseServerEvent(JSON.parse(e.data));
      if (event) messages.push({ role: 'assistant', text: event.text });
    });
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
      socket?.close();
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  });

  async function restoreSession() {
    const token = await getToken();
    if (token) {
      user = await fetchMe(token);
      if (user) void loadMatch();
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

      // Any other page: read it, try to recognise it as a catalog job (curated
      // card), else match against the scraped posting text.
      const snap = await readSnapshot();
      const headline = snap?.headline || snap?.title || '';
      const { company, title } = guessJobIdentity(url, headline);
      const catalogSlug = company && title ? await findJob(company, title, token) : null;

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
      else void loadMatch();
    } catch (err) {
      authError = err instanceof Error ? err.message : 'Sign-in failed';
    } finally {
      authBusy = false;
    }
  }

  async function handleSignOut() {
    await signOut();
    user = null;
  }

  function send(event: ClientEvent) {
    socket?.send(JSON.stringify(event));
  }

  function sendMessage() {
    const text = draft.trim();
    if (!text || !connected) return;
    messages.push({ role: 'user', text });
    send({ type: 'user_message', text });
    draft = '';
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

  async function autofill() {
    const token = await getToken();
    if (!token || autofilling) return;
    autofilling = true;
    try {
      const formReply = (await browser.runtime.sendMessage({
        kind: 'GET_FORM',
      } satisfies RuntimeMessage)) as RuntimeMessage | undefined;
      if (formReply?.kind !== 'FORM' || formReply.fields.length === 0) {
        messages.push({ role: 'system', text: 'No form fields found on this page.' });
        return;
      }
      const values = profileToValues(await getAutofillProfile(token));
      const fills = formReply.fields.flatMap((f) => {
        const key = matchFieldKey(f.label);
        const value = key ? values[key] : '';
        return key && value ? [{ index: f.index, value }] : [];
      });
      if (fills.length === 0) {
        messages.push({ role: 'system', text: 'Nothing matched your profile on this form.' });
        return;
      }
      const applied = (await browser.runtime.sendMessage({
        kind: 'APPLY_FILLS',
        fills,
      } satisfies RuntimeMessage)) as RuntimeMessage | undefined;
      const n = applied?.kind === 'FILLS_APPLIED' ? applied.written : 0;
      messages.push({ role: 'system', text: `✓ Autofilled ${n} field${n === 1 ? '' : 's'} — review before submitting.` });
    } catch (err) {
      messages.push({ role: 'system', text: `Autofill failed: ${err instanceof Error ? err.message : 'error'}` });
    } finally {
      autofilling = false;
    }
  }

  async function readPage() {
    const reply = (await browser.runtime.sendMessage({
      kind: 'GET_PAGE_SNAPSHOT',
    } satisfies RuntimeMessage)) as RuntimeMessage | undefined;

    if (reply?.kind !== 'PAGE_SNAPSHOT') return;
    const { snapshot } = reply;
    messages.push({
      role: 'system',
      text: `📄 ${snapshot.headline || snapshot.title || snapshot.url}`,
    });
    send({ type: 'page_context', snapshot });
  }
</script>

<div class="app">
  <header>
    <div class="top">
      <strong>freehire</strong>
      <span class="status" class:online={connected}>
        {connected ? 'connected' : 'offline'}
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
  {/if}

  <div class="messages">
    {#each messages as message}
      <div class="message {message.role}">{message.text}</div>
    {/each}
    {#if messages.length === 0}
      <p class="empty">Read the current page or say something to start.</p>
    {/if}
  </div>

  <div class="composer">
    {#if user}
      <button class="ghost" onclick={autofill} disabled={autofilling}>
        {autofilling ? 'Filling…' : 'Autofill'}
      </button>
    {/if}
    <button class="ghost" onclick={readPage}>Read page</button>
    <input
      placeholder="Message the agent…"
      bind:value={draft}
      onkeydown={(e) => e.key === 'Enter' && sendMessage()}
    />
    <button onclick={sendMessage} disabled={!connected}>Send</button>
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
