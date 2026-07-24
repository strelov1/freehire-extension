/**
 * The extension's "eyes + hands" for a page's form: a serialisable observation
 * (extractForm) the agent can reason over, and an executor (applyFills) that
 * writes values back, dispatching native input/change events so React/Angular
 * ATS forms register the change. Field elements are addressed by a stable index
 * into collectFillable, so an observation and its fills stay in lockstep without
 * shipping DOM nodes across the content↔panel boundary.
 */

import type { FieldTag, FormField, Fill } from './protocol';

type Fillable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

// Input types that are not free-fill targets.
const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);

/** The ordered list of fillable controls — the index space for observe + act. */
export function collectFillable(doc: Document): Fillable[] {
  const all = Array.from(doc.querySelectorAll<Fillable>('input, select, textarea'));
  return all.filter((el) => {
    if (el.disabled) return false;
    if (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type)) return false;
    return true;
  });
}

/** Serialises the page's form into indexed FormFields. Pure over the document. */
export function extractForm(doc: Document): FormField[] {
  return collectFillable(doc).map((el, index) => {
    const tag = el.tagName.toLowerCase() as FieldTag;
    const field: FormField = {
      index,
      tag,
      type: el instanceof HTMLInputElement ? el.type : tag,
      label: extractLabel(el),
      name: el.getAttribute('name') ?? '',
      required: el.required,
      value: el.value ?? '',
    };
    if (el instanceof HTMLSelectElement) {
      field.options = Array.from(el.options).map((o) => (o.textContent ?? '').trim());
    }
    return field;
  });
}

/** Best-effort human label for a control, in decreasing reliability. */
function extractLabel(el: Fillable): string {
  const fromLabels = Array.from(el.labels ?? [])
    .map((l) => l.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  if (fromLabels) return fromLabels;

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }

  return (
    el.getAttribute('aria-label')?.trim() ||
    el.getAttribute('placeholder')?.trim() ||
    el.getAttribute('name')?.trim() ||
    ''
  );
}

/** Canonical profile keys and the label synonyms that map to them. */
const FIELD_SYNONYMS: Record<string, string[]> = {
  fullName: ['full name', 'your name', 'candidate name', 'applicant name'],
  firstName: ['first name', 'given name', 'legal first name', 'preferred first name'],
  lastName: ['last name', 'family name', 'surname', 'legal last name'],
  email: ['email', 'e-mail', 'e-mail address', 'email address'],
  phone: ['phone', 'mobile', 'telephone', 'contact number', 'cell'],
  city: ['city', 'town', 'current location', 'location (city)'],
  state: ['state', 'province', 'region'],
  country: ['country'],
  postalCode: ['postal code', 'zip', 'zip code', 'pincode', 'pin code'],
  linkedin: ['linkedin'],
  github: ['github'],
  portfolio: ['portfolio', 'website', 'personal site'],
};

/** Maps a control's label to a canonical profile key, or null when unknown. */
export function matchFieldKey(label: string): string | null {
  const normalized = label.toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  for (const [key, synonyms] of Object.entries(FIELD_SYNONYMS)) {
    if (synonyms.some((s) => normalized === s || normalized.includes(s))) return key;
  }
  return null;
}

/** Applies fills by index, returning how many controls were written. */
export function applyFills(doc: Document, fills: Fill[]): number {
  const controls = collectFillable(doc);
  let written = 0;
  for (const { index, value } of fills) {
    const el = controls[index];
    if (el && fillField(el, value)) written++;
  }
  return written;
}

/** Writes one control, dispatching native events. Returns false if unfillable. */
export function fillField(el: Fillable, value: string): boolean {
  if (el instanceof HTMLSelectElement) {
    const match = Array.from(el.options).find(
      (o) =>
        (o.textContent ?? '').trim().toLowerCase() === value.toLowerCase() ||
        o.value.toLowerCase() === value.toLowerCase(),
    );
    if (!match) return false;
    el.value = match.value;
    dispatchNative(el);
    return true;
  }
  setNativeValue(el, value);
  return true;
}

// React/Angular track the input's value via a native setter; calling it (rather
// than el.value =) plus bubbling input/change is what makes them notice the fill.
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  dispatchNative(el);
}

function dispatchNative(el: Fillable): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
