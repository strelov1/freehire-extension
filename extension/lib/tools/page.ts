/**
 * The `PageBridge` backed by the real browser: it asks the background relay,
 * which fans the request out across the active tab's frames. Thin glue — the
 * dispatch and merge logic it feeds lives in `executor.ts`, where it is tested.
 */

import { browser } from 'wxt/browser';
import type { LabelFill, RuntimeMessage } from '../protocol';
import type { PageBridge } from './executor';
import type { FramedField } from './wire';

async function ask(message: RuntimeMessage): Promise<RuntimeMessage | undefined> {
  return (await browser.runtime.sendMessage(message)) as RuntimeMessage | undefined;
}

export const activeTabPage: PageBridge = {
  async readForm(): Promise<FramedField[]> {
    const reply = await ask({ kind: 'GET_FRAMED_FORM' });
    if (reply?.kind !== 'FRAMED_FORM') throw new Error('could not read the page');
    return reply.fields;
  },

  async fillSimple(fills: LabelFill[]) {
    const reply = await ask({ kind: 'FILL_BY_LABEL', fills });
    if (reply?.kind !== 'FILL_OUTCOMES') throw new Error('could not reach the page to fill it');
    return reply.outcomes;
  },
};
