/**
 * Shapes for the in-extension transport: `RuntimeMessage` over chrome.runtime
 * (panel <-> background <-> content), discriminated by `kind`. The chat itself
 * talks to Roy directly over its own control protocol (see `lib/roy/`), not
 * through here.
 */

/** A read of whatever page the user is currently looking at. */
export interface PageSnapshot {
  url: string;
  title: string;
  /** Best-effort primary heading of the page (e.g. a job title). */
  headline: string;
  /** Visible text, trimmed and length-capped. */
  text: string;
}

export type FieldTag = 'input' | 'select' | 'textarea';

/** A serialisable view of one fillable form control (see lib/form.ts). */
export interface FormField {
  index: number;
  tag: FieldTag;
  type: string;
  label: string;
  name: string;
  required: boolean;
  value: string;
  options?: string[];
}

/** A value to write into the control at `index`. */
export interface Fill {
  index: number;
  value: string;
}

/** Messages passed inside the extension via chrome.runtime. */
export type RuntimeMessage =
  | { kind: 'GET_PAGE_SNAPSHOT' }
  | { kind: 'PAGE_SNAPSHOT'; snapshot: PageSnapshot }
  | { kind: 'GET_FORM' }
  | { kind: 'FORM'; fields: FormField[] }
  | { kind: 'APPLY_FILLS'; fills: Fill[] }
  | { kind: 'FILLS_APPLIED'; written: number };

/** An empty snapshot, used when no active tab can be read. */
export function emptySnapshot(): PageSnapshot {
  return { url: '', title: '', headline: '', text: '' };
}
