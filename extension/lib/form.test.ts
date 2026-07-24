import { describe, it, expect, beforeEach } from 'vitest';
import { extractForm, matchFieldKey, applyFills } from './form';

function reset() {
  document.body.replaceChildren();
}

function labeledInput(id: string, labelText: string, attrs: Record<string, string> = {}) {
  const label = document.createElement('label');
  label.setAttribute('for', id);
  label.textContent = labelText;
  const input = document.createElement('input');
  input.id = id;
  for (const [k, v] of Object.entries(attrs)) input.setAttribute(k, v);
  document.body.append(label, input);
  return input;
}

describe('extractForm', () => {
  beforeEach(reset);

  it('indexes fillable fields with their label, type and required flag', () => {
    labeledInput('fn', 'First Name', { type: 'text', name: 'first', required: '' });
    labeledInput('em', 'Email Address', { type: 'email', name: 'email' });

    const fields = extractForm(document);

    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatchObject({ index: 0, type: 'text', label: 'First Name', name: 'first', required: true });
    expect(fields[1]).toMatchObject({ index: 1, type: 'email', label: 'Email Address', required: false });
  });

  it('skips hidden, submit and disabled controls', () => {
    labeledInput('a', 'Keep', { type: 'text' });
    labeledInput('b', 'Hidden', { type: 'hidden' });
    labeledInput('c', 'Submit', { type: 'submit' });
    labeledInput('d', 'Disabled', { type: 'text', disabled: '' });

    const fields = extractForm(document);
    expect(fields.map((f) => f.label)).toEqual(['Keep']);
  });

  it('captures select options', () => {
    const label = document.createElement('label');
    label.setAttribute('for', 'country');
    label.textContent = 'Country';
    const select = document.createElement('select');
    select.id = 'country';
    for (const c of ['United States', 'Canada']) {
      const opt = document.createElement('option');
      opt.textContent = c;
      select.append(opt);
    }
    document.body.append(label, select);

    const [field] = extractForm(document);
    expect(field).toMatchObject({ tag: 'select', label: 'Country', options: ['United States', 'Canada'] });
  });
});

describe('applyFills', () => {
  beforeEach(reset);

  it('writes values by index and dispatches a bubbling input event', () => {
    const first = labeledInput('fn', 'First Name', { type: 'text' });
    const email = labeledInput('em', 'Email', { type: 'email' });
    let inputEvents = 0;
    first.addEventListener('input', (e) => e.bubbles && inputEvents++);

    const written = applyFills(document, [
      { index: 0, value: 'Ilya' },
      { index: 1, value: 'ilya@example.com' },
    ]);

    expect(written).toBe(2);
    expect(first.value).toBe('Ilya');
    expect(email.value).toBe('ilya@example.com');
    expect(inputEvents).toBe(1);
  });
});

describe('matchFieldKey', () => {
  it('maps common labels to canonical profile keys', () => {
    expect(matchFieldKey('First Name')).toBe('firstName');
    expect(matchFieldKey('Legal Last Name *')).toBe('lastName');
    expect(matchFieldKey('E-mail Address')).toBe('email');
    expect(matchFieldKey('LinkedIn URL')).toBe('linkedin');
  });

  it('returns null for an unknown label', () => {
    expect(matchFieldKey('Favourite colour')).toBeNull();
  });
});
