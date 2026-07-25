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
  /** True for a custom-widget combobox (react-select and friends), which the
   *  simple filler must not write into — see `fillByLabel`. */
  combo: boolean;
  options?: string[];
}

/** A control plus the tab frame it lives in; 0 is the top document. */
export interface FramedField extends FormField {
  frame: number;
}

/** A value to write into the control at `index`. */
export interface Fill {
  index: number;
  value: string;
}

/** A value to write into the control carrying `label` (see `fillByLabel`). */
export interface LabelFill {
  label: string;
  value: string;
}

/**
 * What became of one `LabelFill`. Every requested fill gets an outcome, so a
 * caller never has to infer failure from a silent absence.
 */
export type FillStatus =
  /** Written, and native input/change dispatched. */
  | 'filled'
  /** No control on the page carries that label. */
  | 'not_found'
  /** A custom-widget combobox — deliberately left alone (deferred capability). */
  | 'deferred_combobox'
  /** A native <select> with no option matching the value. */
  | 'no_option';

export interface FillOutcome {
  label: string;
  status: FillStatus;
}

/** Messages passed inside the extension via chrome.runtime. */
export type RuntimeMessage =
  | { kind: 'GET_PAGE_SNAPSHOT' }
  | { kind: 'PAGE_SNAPSHOT'; snapshot: PageSnapshot }
  | { kind: 'GET_FORM' }
  | { kind: 'FORM'; fields: FormField[] }
  | { kind: 'APPLY_FILLS'; fills: Fill[] }
  | { kind: 'FILLS_APPLIED'; written: number }
  // The browser-tool primitives: read every frame, and fill by label. Both fan
  // out across the tab's frames in the background relay.
  | { kind: 'GET_FRAMED_FORM' }
  | { kind: 'FRAMED_FORM'; fields: FramedField[] }
  | { kind: 'FILL_BY_LABEL'; fills: LabelFill[] }
  | { kind: 'FILL_OUTCOMES'; outcomes: FillOutcome[] };

/** An empty snapshot, used when no active tab can be read. */
export function emptySnapshot(): PageSnapshot {
  return { url: '', title: '', headline: '', text: '' };
}
