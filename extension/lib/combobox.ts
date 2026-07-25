/**
 * The four primitives that drive a custom-widget combobox the way a person does:
 * open it, read what it actually offers, choose one, confirm what got committed.
 * Writing text into such a widget commits whatever its listbox happens to
 * highlight — the spike's "Norfolk Island" for a question wanting "No" — so
 * `fill_simple` refuses them and these primitives replace it.
 *
 * Pure over the Document, like `form.ts`, but asynchronous: a widget re-renders
 * when its framework decides to, not when the event is dispatched, so opening and
 * selecting must be *awaited* rather than dispatched-and-read.
 */

import type { ComboboxReply, ComboboxStep } from './protocol';
import { collectQuestions, comboListbox, comboOptionNodes, isComboWidget, normalizeLabel } from './form';

export type OpenStatus = 'opened' | 'did_not_open' | 'not_found';
export type OptionsStatus = 'open' | 'not_open' | 'not_found';
export type SelectStatus = 'selected' | 'no_option' | 'not_open' | 'not_found';
export type VerifyStatus = 'verified' | 'mismatch' | 'empty' | 'not_found';

/** How long a widget gets to re-render before it counts as unresponsive. */
const SETTLE_MS = 1000;
const POLL_MS = 25;

/**
 * Reveals the widget's listbox. Reports `did_not_open` rather than assuming, so
 * the agent stops instead of acting blind on a widget it cannot drive.
 */
export async function open(doc: Document, label: string): Promise<{ status: OpenStatus }> {
  const widget = findWidget(doc, label);
  if (!widget) return { status: 'not_found' };
  if (isOpen(widget)) return { status: 'opened' };

  press(widget);
  return { status: (await settle(() => isOpen(widget))) ? 'opened' : 'did_not_open' };
}

/**
 * What the open widget currently offers — the evidence the agent chooses from.
 * A closed widget and an open one offering nothing are reported apart, because
 * their remedies differ: the first needs opening, while the second is a typeahead
 * that fetches its options over the network and is out of scope.
 */
export function options(doc: Document, label: string): { status: OptionsStatus; options: string[] } {
  const widget = findWidget(doc, label);
  if (!widget) return { status: 'not_found', options: [] };
  if (!isOpen(widget)) return { status: 'not_open', options: [] };
  return { status: 'open', options: comboOptionNodes(widget).map(text).filter(Boolean) };
}

/**
 * Commits an offered option by acting on the option itself. A value the widget
 * does not offer commits nothing: approximating it is how a question wanting
 * "No" ends up holding "Norfolk Island".
 */
export async function select(doc: Document, label: string, value: string): Promise<{ status: SelectStatus }> {
  const widget = findWidget(doc, label);
  if (!widget) return { status: 'not_found' };
  if (!isOpen(widget)) return { status: 'not_open' };

  const option = comboOptionNodes(widget).find((o) => normalizeLabel(text(o)) === normalizeLabel(value));
  if (!option) return { status: 'no_option' };

  press(option);
  // Waiting for the widget to close is what makes a following `verify` read the
  // committed value rather than the state before the commit landed. Whether the
  // right value arrived is `verify`'s call, never this one's.
  await settle(() => !isOpen(widget));
  return { status: 'selected' };
}

/**
 * Reads back what the widget now holds, as the widget itself displays it, and
 * says whether that is what was asked for.
 *
 * The comparison is containment in one direction — the committed text must sit
 * inside the chosen option — because a widget may legitimately display a
 * shortened form: the live phone-code widget commits "+358" for the option
 * "Åland Islands +358". The other direction looks equally reasonable and is
 * quietly wrong, since "No" sits inside "Norfolk Island" and would reinstate the
 * exact failure these primitives exist to prevent.
 */
export function verify(
  doc: Document,
  label: string,
  expected: string,
): { status: VerifyStatus; committed: string } {
  const widget = findWidget(doc, label);
  if (!widget) return { status: 'not_found', committed: '' };

  const committed = displayedValue(widget);
  if (!committed) return { status: 'empty', committed: '' };
  const matches = normalizeLabel(expected).includes(normalizeLabel(committed));
  return { status: matches ? 'verified' : 'mismatch', committed };
}

/**
 * Runs one step against this document. The content script is a relay, so the
 * mapping from a wire step to a primitive lives here where it is tested; a frame
 * that does not hold the widget answers `not_found` and the background relay
 * keeps whichever frame does.
 */
export function runStep(doc: Document, step: ComboboxStep): Promise<ComboboxReply> {
  switch (step.action) {
    case 'open':
      return open(doc, step.label);
    case 'options':
      return Promise.resolve(options(doc, step.label));
    case 'select':
      return select(doc, step.label, step.value);
    case 'verify':
      return Promise.resolve(verify(doc, step.label, step.value));
  }
}

/** The custom-widget combobox carrying `label`, or null when none does. */
function findWidget(doc: Document, label: string): Element | null {
  const question = collectQuestions(doc).find((q) => normalizeLabel(q.label) === normalizeLabel(label));
  const [el] = question?.controls ?? [];
  return el && isComboWidget(el) ? el : null;
}

/**
 * Whether the widget is showing its listbox.
 *
 * A widget that states `aria-expanded` is taken at its word: several libraries
 * keep the listbox in the DOM and hide it, so its mere presence means nothing —
 * treating that as open would report a full option list for a widget nobody
 * opened. Only where the widget makes no such claim does the listbox's own
 * visibility decide.
 */
function isOpen(widget: Element): boolean {
  const expanded = widget.getAttribute('aria-expanded');
  if (expanded !== null) return expanded === 'true';
  const listbox = comboListbox(widget);
  return listbox !== null && (typeof listbox.checkVisibility !== 'function' || listbox.checkVisibility());
}

// react-select's rendered value and placeholder, by the emotion class names it
// generates. Only the *reading* path guesses at class names; see displayedValue.
const VALUE_NODE = '[class*="singleValue"], [class*="single-value"], [class*="multiValue"], [class*="multi-value"]';
const PLACEHOLDER_NODE = '[class*="placeholder"]';

/**
 * The value the widget displays, or '' when it displays none.
 *
 * A react-select keeps its committed value in its own markup — the input's
 * `value` is empty even after a successful commit — so this walks up from the
 * widget looking for the rendered value. It stops the moment the subtree holds a
 * second combobox, which is what makes reporting a *neighbour's* value
 * impossible: on a form of 27 widgets that would be a success reported for a
 * write that never happened.
 */
function displayedValue(widget: Element): string {
  for (let el = widget.parentElement; el; el = el.parentElement) {
    if (el.querySelectorAll('[role="combobox"]').length > 1) return '';
    const shown = el.querySelector(VALUE_NODE);
    if (shown) return text(shown);
    // A visible placeholder means the widget is showing "Select…", not an answer.
    if (el.querySelector(PLACEHOLDER_NODE)) return '';
  }
  return '';
}

/**
 * The pointer sequence a real click produces, dispatched on the element itself:
 * a widget's handler sits on an ancestor and events bubble, so this reaches it
 * without having to guess which ancestor is the widget's "control" by class name.
 */
function press(el: Element): void {
  if (typeof PointerEvent === 'function') {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true }));
  }
  for (const type of ['mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0 }));
  }
}

/** Waits for a condition the widget's framework may only satisfy on a later tick. */
async function settle(holds: () => boolean): Promise<boolean> {
  for (let waited = 0; waited < SETTLE_MS; waited += POLL_MS) {
    if (holds()) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return holds();
}

function text(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}
