/**
 * The `PageBridge` backed by the real browser: it asks the background relay,
 * which fans the request out across the active tab's frames. Thin glue — the
 * dispatch and merge logic it feeds lives in `executor.ts`, where it is tested.
 */

import { browser } from 'wxt/browser';
import type { ComboboxStep, LabelFill, RuntimeMessage } from '../protocol';
import type { FormObservation, PageBridge } from './executor';

async function ask(message: RuntimeMessage): Promise<RuntimeMessage | undefined> {
  return (await browser.runtime.sendMessage(message)) as RuntimeMessage | undefined;
}

export const activeTabPage: PageBridge = {
  async readPage() {
    const reply = await ask({ kind: 'GET_PAGE_SNAPSHOT' });
    if (reply?.kind !== 'PAGE_SNAPSHOT') throw new Error('could not read the page');
    return reply.snapshot;
  },

  async readForm(): Promise<FormObservation> {
    const reply = await ask({ kind: 'GET_FRAMED_FORM' });
    if (reply?.kind !== 'FRAMED_FORM') throw new Error('could not read the page');
    return { fields: reply.fields, uploads: reply.uploads };
  },

  async fillSimple(fills: LabelFill[]) {
    const reply = await ask({ kind: 'FILL_BY_LABEL', fills });
    if (reply?.kind !== 'FILL_OUTCOMES') throw new Error('could not reach the page to fill it');
    return reply.outcomes;
  },

  async combobox(step: ComboboxStep) {
    const reply = await ask({ kind: 'COMBOBOX_STEP', step });
    if (reply?.kind !== 'COMBOBOX_REPLY') throw new Error('could not reach the page to drive the widget');
    return reply.reply;
  },
};
