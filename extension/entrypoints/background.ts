import { emptySnapshot, type RuntimeMessage, type FramedField } from '../lib/protocol';
import { mergeFrameOutcomes } from '../lib/tools/executor';

/**
 * Service worker. Three jobs, all thin:
 *  - open the side panel when the toolbar icon is clicked;
 *  - relay a snapshot request from the panel to the active tab's content
 *    script (the panel can't message a content script directly);
 *  - fan the browser-tool primitives out across the tab's frames, since an
 *    apply form is often served from an ATS iframe. Only this side knows the
 *    frame ids, so it is also what tags the fields it reads back.
 */
export default defineBackground(() => {
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('setPanelBehavior failed', err));

  browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
    switch (message.kind) {
      case 'GET_PAGE_SNAPSHOT':
      case 'GET_FORM':
      case 'APPLY_FILLS':
        return relayToActiveTab(message);
      case 'GET_FRAMED_FORM':
        return readFramedForm();
      case 'FILL_BY_LABEL':
        return fillAcrossFrames(message);
      default:
        return undefined;
    }
  });
});

async function relayToActiveTab(message: RuntimeMessage): Promise<RuntimeMessage | undefined> {
  const tabId = await activeTabId();
  if (tabId == null) {
    // Only the snapshot request has a meaningful empty reply.
    return message.kind === 'GET_PAGE_SNAPSHOT'
      ? { kind: 'PAGE_SNAPSHOT', snapshot: emptySnapshot() }
      : undefined;
  }
  return browser.tabs.sendMessage(tabId, message);
}

/** Reads every frame of the active tab, tagging each field with its frame. */
async function readFramedForm(): Promise<RuntimeMessage> {
  const fields: FramedField[] = [];
  await eachFrame({ kind: 'GET_FRAMED_FORM' }, (reply, frame) => {
    if (reply?.kind !== 'FORM') return;
    for (const field of reply.fields) fields.push({ ...field, frame });
  });
  return { kind: 'FRAMED_FORM', fields };
}

/**
 * Offers the fills to every frame and folds the answers together. A frame that
 * does not hold the field reports `not_found`, so the merge keeps whichever
 * frame actually did something with it.
 */
async function fillAcrossFrames(message: RuntimeMessage & { kind: 'FILL_BY_LABEL' }): Promise<RuntimeMessage> {
  const perFrame: Parameters<typeof mergeFrameOutcomes>[0] = [];
  await eachFrame(message, (reply) => {
    if (reply?.kind === 'FILL_OUTCOMES') perFrame.push(reply.outcomes);
  });
  return { kind: 'FILL_OUTCOMES', outcomes: mergeFrameOutcomes(perFrame) };
}

/** Sends a message to each injectable frame of the active tab, in parallel. */
async function eachFrame(
  message: RuntimeMessage,
  take: (reply: RuntimeMessage | undefined, frame: number) => void,
): Promise<void> {
  const tabId = await activeTabId();
  if (tabId == null) return;
  await Promise.all(
    (await frameIds(tabId)).map(async (frameId) => {
      try {
        take((await browser.tabs.sendMessage(tabId, message, { frameId })) as RuntimeMessage, frameId);
      } catch {
        // No content script in that frame (about:blank, a restricted origin) —
        // it simply contributes nothing.
      }
    }),
  );
}

/**
 * The frames of a tab we can reach. Enumerated by injecting a no-op into all of
 * them: each InjectionResult carries its frameId, which gives us the list using
 * the `scripting` permission we already hold, without asking for `webNavigation`.
 */
async function frameIds(tabId: number): Promise<number[]> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => 0,
    });
    return results.map((r) => r.frameId);
  } catch {
    return [0];
  }
}

async function activeTabId(): Promise<number | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}
