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

  browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
    if (message.kind === 'GET_PAGE_SNAPSHOT') {
      return requestSnapshotFromActiveTab();
    }
    return undefined;
  });
});

async function requestSnapshotFromActiveTab(): Promise<RuntimeMessage> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) {
    return { kind: 'PAGE_SNAPSHOT', snapshot: emptySnapshot() };
  }
  return browser.tabs.sendMessage(tab.id, {
    kind: 'GET_PAGE_SNAPSHOT',
  } satisfies RuntimeMessage);
}
