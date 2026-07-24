<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import {
    parseServerEvent,
    type ClientEvent,
    type RuntimeMessage,
  } from '../../lib/protocol';
  import { signIn, signOut, getToken, fetchMe, type HireUser } from '../../lib/auth';
  import {
    freehireSlugFromUrl,
    getJob,
    getMatch,
    type FreehireJob,
    type JobMatch,
  } from '../../lib/freehire';
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

  type MatchStatus = 'idle' | 'loading' | 'ready' | 'error' | 'not-a-job';
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
    return () => socket?.close();
  });

  async function restoreSession() {
    const token = await getToken();
    if (token) {
      user = await fetchMe(token);
      if (user) void loadMatch();
    }
  }

  async function loadMatch() {
    const token = await getToken();
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const slug = tab?.url ? freehireSlugFromUrl(tab.url) : null;
    if (!token || !slug) {
      matchStatus = 'not-a-job';
      matchJob = null;
      match = null;
      return;
    }
    matchStatus = 'loading';
    matchError = '';
    try {
      const [job, m] = await Promise.all([getJob(slug, token), getMatch(slug, token)]);
      matchJob = job;
      match = m;
      matchStatus = 'ready';
    } catch (err) {
      matchError = err instanceof Error ? err.message : 'Could not load match';
      matchStatus = 'error';
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
      <p class="match-hint err">Match unavailable: {matchError}</p>
    {:else if matchStatus === 'not-a-job'}
      <p class="match-hint">
        Open a freehire job page to see your match.
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
