<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import {
    parseServerEvent,
    type ClientEvent,
    type RuntimeMessage,
  } from '../../lib/protocol';

  const SERVER_URL = 'ws://localhost:3899/ws';

  type ChatMessage = { role: 'user' | 'assistant' | 'system'; text: string };

  let messages = $state<ChatMessage[]>([]);
  let draft = $state('');
  let connected = $state(false);
  let socket: WebSocket | null = null;

  onMount(() => {
    socket = new WebSocket(SERVER_URL);
    socket.addEventListener('open', () => (connected = true));
    socket.addEventListener('close', () => (connected = false));
    socket.addEventListener('message', (e) => {
      const event = parseServerEvent(JSON.parse(e.data));
      if (event) messages.push({ role: 'assistant', text: event.text });
    });
    return () => socket?.close();
  });

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
    <strong>freehire</strong>
    <span class="status" class:online={connected}>
      {connected ? 'connected' : 'offline'}
    </span>
  </header>

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
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid #e5e5e5;
  }

  .status {
    font-size: 12px;
    color: #999;
  }

  .status.online {
    color: #1a8917;
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
