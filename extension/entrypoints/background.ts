import { emptySnapshot, type RuntimeMessage } from '../lib/protocol';

/**
 * Service worker. Two jobs, both thin:
 *  - open the side panel when the toolbar icon is clicked;
 *  - relay a snapshot request from the panel to the active tab's content
 *    script (the panel can't message a content script directly).
 */
export default defineBackground(() => {
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('setPanelBehavior failed', err));

  // Relay panel requests to the active tab's content script (the panel can't
  // message a content script directly).
  browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
    if (message.kind === 'GET_PAGE_SNAPSHOT' || message.kind === 'GET_FORM' || message.kind === 'APPLY_FILLS') {
      return relayToActiveTab(message);
    }
    return undefined;
  });
});

async function relayToActiveTab(message: RuntimeMessage): Promise<RuntimeMessage | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) {
    // Only the snapshot request has a meaningful empty reply.
    return message.kind === 'GET_PAGE_SNAPSHOT'
      ? { kind: 'PAGE_SNAPSHOT', snapshot: emptySnapshot() }
      : undefined;
  }
  return browser.tabs.sendMessage(tab.id, message);
}
