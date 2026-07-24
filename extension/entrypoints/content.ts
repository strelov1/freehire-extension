import { extractSnapshot } from '../lib/scraper';
import { extractForm, applyFills } from '../lib/form';
import type { RuntimeMessage } from '../lib/protocol';

/**
 * Injected into every page. The extension's eyes + hands: it reads the page
 * (snapshot, form) and writes fills back. Owns no state.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
      switch (message.kind) {
        case 'GET_PAGE_SNAPSHOT':
          return Promise.resolve<RuntimeMessage>({
            kind: 'PAGE_SNAPSHOT',
            snapshot: extractSnapshot(document),
          });
        case 'GET_FORM':
          return Promise.resolve<RuntimeMessage>({
            kind: 'FORM',
            fields: extractForm(document),
          });
        case 'APPLY_FILLS':
          return Promise.resolve<RuntimeMessage>({
            kind: 'FILLS_APPLIED',
            written: applyFills(document, message.fills),
          });
        default:
          return undefined;
      }
    });
  },
});
