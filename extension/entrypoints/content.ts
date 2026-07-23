import { extractSnapshot } from '../lib/scraper';
import type { RuntimeMessage } from '../lib/protocol';

/**
 * Injected into every page. It owns no state — it just answers a snapshot
 * request with a read of the live document.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
      if (message.kind === 'GET_PAGE_SNAPSHOT') {
        const reply: RuntimeMessage = {
          kind: 'PAGE_SNAPSHOT',
          snapshot: extractSnapshot(document),
        };
        return Promise.resolve(reply);
      }
      return undefined;
    });
  },
});
