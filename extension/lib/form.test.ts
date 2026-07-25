import { describe, it, expect, beforeEach } from 'vitest';
import { extractForm, matchFieldKey, applyFills, fillByLabel } from './form';

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

  it('treats aria-required as required, which is how ATS forms mark it', () => {
    labeledInput('a', 'Employer', { type: 'text', 'aria-required': 'true' });
    labeledInput('b', 'Nickname', { type: 'text' });

    expect(extractForm(document).map((f) => [f.label, f.required])).toEqual([
      ['Employer', true],
      ['Nickname', false],
    ]);
  });

  it('skips hidden, submit and disabled controls', () => {
    labeledInput('a', 'Keep', { type: 'text' });
    labeledInput('b', 'Hidden', { type: 'hidden' });
    labeledInput('c', 'Submit', { type: 'submit' });
    labeledInput('d', 'Disabled', { type: 'text', disabled: '' });

    const fields = extractForm(document);
    expect(fields.map((f) => f.label)).toEqual(['Keep']);
  });

  it('skips controls the user cannot see', () => {
    labeledInput('a', 'Keep', { type: 'text' });
    // A real Greenhouse form carries one of these: a hidden recaptcha textarea.
    const recaptcha = document.createElement('textarea');
    recaptcha.setAttribute('name', 'g-recaptcha-response');
    recaptcha.style.display = 'none';
    // …and controls buried in a collapsed section.
    const collapsed = document.createElement('div');
    collapsed.style.display = 'none';
    const buried = document.createElement('input');
    buried.setAttribute('aria-label', 'Buried');
    collapsed.append(buried);
    document.body.append(recaptcha, collapsed);

    expect(extractForm(document).map((f) => f.label)).toEqual(['Keep']);
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

describe('extractForm combo flag', () => {
  beforeEach(reset);

  it('flags custom-widget comboboxes and leaves plain controls alone', () => {
    labeledInput('plain', 'City', { type: 'text' });
    labeledInput('rs', 'Country', { type: 'text', role: 'combobox', 'aria-autocomplete': 'list' });

    const fields = extractForm(document);

    expect(fields.map((f) => [f.label, f.combo])).toEqual([
      ['City', false],
      ['Country', true],
    ]);
  });

  it('does not flag a native select as a custom widget', () => {
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Country');
    document.body.append(select);

    expect(extractForm(document)[0].combo).toBe(false);
  });

  it("carries a widget's options when it exposes them without being opened", () => {
    const combo = labeledInput('wa', 'Work authorization', {
      type: 'text',
      role: 'combobox',
      'aria-controls': 'wa-listbox',
    });
    const listbox = document.createElement('div');
    listbox.id = 'wa-listbox';
    listbox.setAttribute('role', 'listbox');
    for (const text of ['Yes', 'No']) {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.textContent = text;
      listbox.append(option);
    }
    document.body.append(listbox);

    const [field] = extractForm(document);
    expect(field).toMatchObject({ label: 'Work authorization', combo: true, options: ['Yes', 'No'] });
    expect(combo.value).toBe('');
  });

  it('reports no options for a widget that only renders them once opened', () => {
    // A react-select while closed: its listbox does not exist yet, so
    // aria-controls is absent. The agent must reach for combobox.open.
    labeledInput('co', 'Country', { type: 'text', role: 'combobox', 'aria-autocomplete': 'list' });

    const [field] = extractForm(document);
    expect(field.combo).toBe(true);
    expect(field.options).toBeUndefined();
  });

  it("does not lift a neighbouring widget's options onto a closed one", () => {
    // Two widgets, one open. A page-wide [role=option] sweep would hand the
    // open widget's countries to the closed sponsorship question.
    labeledInput('sp', 'Do you require sponsorship', { type: 'text', role: 'combobox' });
    labeledInput('ct', 'Country', { type: 'text', role: 'combobox', 'aria-controls': 'ct-listbox' });
    const listbox = document.createElement('div');
    listbox.id = 'ct-listbox';
    listbox.setAttribute('role', 'listbox');
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    option.textContent = 'Germany';
    listbox.append(option);
    document.body.append(listbox);

    const [sponsorship, country] = extractForm(document);
    expect(sponsorship.options).toBeUndefined();
    expect(country.options).toEqual(['Germany']);
  });
});

describe('fillByLabel', () => {
  beforeEach(reset);

  it('writes text, checkbox and native-select values addressed by label', () => {
    const name = labeledInput('fn', 'First Name *', { type: 'text' });
    const agree = labeledInput('ag', 'I agree', { type: 'checkbox' });
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

    const outcomes = fillByLabel(document, [
      { label: 'First name', value: 'Ilya' },
      { label: 'I agree', value: 'true' },
      { label: 'Country', value: 'Canada' },
    ]);

    expect(name.value).toBe('Ilya');
    expect(agree.checked).toBe(true);
    expect(select.value).toBe('Canada');
    expect(outcomes.every((o) => o.status === 'filled')).toBe(true);
  });

  it('lands values on the right field after a re-render changes the control count', () => {
    labeledInput('em', 'Email', { type: 'email' });
    const observed = extractForm(document).map((f) => f.label);
    expect(observed).toEqual(['Email']);

    // The form re-renders: a new control appears *before* the observed one, so
    // any positional addressing would now target the wrong element.
    const extra = document.createElement('input');
    extra.type = 'text';
    extra.setAttribute('aria-label', 'Referral code');
    document.body.prepend(extra);

    fillByLabel(document, [{ label: 'Email', value: 'ilya@example.com' }]);

    expect(extra.value).toBe('');
    expect(document.querySelector<HTMLInputElement>('#em')!.value).toBe('ilya@example.com');
  });

  it('skips a custom-widget combobox instead of writing stale text into it', () => {
    const combo = labeledInput('co', 'Country', { type: 'text', role: 'combobox' });

    const outcomes = fillByLabel(document, [{ label: 'Country', value: 'Canada' }]);

    expect(combo.value).toBe('');
    expect(outcomes).toEqual([{ label: 'Country', status: 'deferred_combobox' }]);
  });

  it('reports an unmatched label and a select value with no matching option', () => {
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Country');
    const opt = document.createElement('option');
    opt.textContent = 'Canada';
    select.append(opt);
    document.body.append(select);

    const outcomes = fillByLabel(document, [
      { label: 'Favourite colour', value: 'blue' },
      { label: 'Country', value: 'Norfolk Island' },
    ]);

    expect(outcomes).toEqual([
      { label: 'Favourite colour', status: 'not_found' },
      { label: 'Country', status: 'no_option' },
    ]);
  });
});

/** A fieldset asking one question through several controls. */
function checkboxGroup(legendText: string, optionLabels: string[], type = 'checkbox') {
  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = legendText;
  fieldset.append(legend);
  const inputs = optionLabels.map((text, i) => {
    const id = `${legendText.slice(0, 4).replace(/\W/g, '')}-${i}`;
    const label = document.createElement('label');
    label.setAttribute('for', id);
    label.textContent = text;
    const input = document.createElement('input');
    input.id = id;
    input.type = type;
    input.name = 'question_65731119[]';
    fieldset.append(label, input);
    return input;
  });
  document.body.append(fieldset);
  return inputs;
}

describe('extractForm grouping', () => {
  beforeEach(reset);

  it('reports a checkbox group as one field carrying the question and its options', () => {
    checkboxGroup('Which countries do you anticipate working in? *', ['Germany', 'Poland', 'Spain']);

    const fields = extractForm(document);

    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      label: 'Which countries do you anticipate working in? *',
      options: ['Germany', 'Poland', 'Spain'],
      type: 'checkbox',
      required: false,
    });
  });

  it('groups a radio set the same way', () => {
    checkboxGroup('Do you require sponsorship?', ['Yes', 'No'], 'radio');

    const [field] = extractForm(document);
    expect(field).toMatchObject({ label: 'Do you require sponsorship?', options: ['Yes', 'No'] });
  });

  it('reports which options of a group are already chosen as its value', () => {
    const [, poland] = checkboxGroup('Countries', ['Germany', 'Poland', 'Spain']);
    poland.checked = true;

    expect(extractForm(document)[0].value).toBe('Poland');
  });

  it('does not group text inputs that merely share a fieldset', () => {
    // An address fieldset: each control is its own question despite the shared
    // legend, so grouping them would hide three fields from the agent.
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = 'Address';
    fieldset.append(legend);
    for (const name of ['Street', 'City', 'Postal code']) {
      const input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('aria-label', name);
      fieldset.append(input);
    }
    document.body.append(fieldset);

    expect(extractForm(document).map((f) => f.label)).toEqual(['Street', 'City', 'Postal code']);
  });

  it('does not group a lone checkbox, whose own label is the question', () => {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = 'Consent';
    const label = document.createElement('label');
    label.setAttribute('for', 'tos');
    label.textContent = 'I agree to the terms';
    const input = document.createElement('input');
    input.id = 'tos';
    input.type = 'checkbox';
    fieldset.append(legend, label, input);
    document.body.append(fieldset);

    expect(extractForm(document).map((f) => f.label)).toEqual(['I agree to the terms']);
  });

  it('leaves a legend-less fieldset ungrouped, having no question to carry', () => {
    const fieldset = document.createElement('fieldset');
    for (const text of ['Germany', 'Poland']) {
      const label = document.createElement('label');
      label.setAttribute('for', text);
      label.textContent = text;
      const input = document.createElement('input');
      input.id = text;
      input.type = 'checkbox';
      fieldset.append(label, input);
    }
    document.body.append(fieldset);

    expect(extractForm(document).map((f) => f.label)).toEqual(['Germany', 'Poland']);
  });

  it('keeps index and control in lockstep once a group has collapsed the field list', () => {
    // The group sits *before* a plain field, so a stale index space would send
    // the email into one of the group's checkboxes.
    checkboxGroup('Countries', ['Germany', 'Poland', 'Spain']);
    const email = labeledInput('em', 'Email', { type: 'email' });

    const fields = extractForm(document);
    const emailField = fields.find((f) => f.label === 'Email')!;
    applyFills(document, [{ index: emailField.index, value: 'ilya@example.com' }]);

    expect(email.value).toBe('ilya@example.com');
  });
});

describe('fillByLabel on a group', () => {
  beforeEach(reset);

  it('ticks the control for the chosen option, reporting the outcome for the question', () => {
    const [germany, poland] = checkboxGroup('Which countries?', ['Germany', 'Poland', 'Spain']);

    const outcomes = fillByLabel(document, [{ label: 'Which countries?', value: 'Poland' }]);

    expect(poland.checked).toBe(true);
    expect(germany.checked).toBe(false);
    expect(outcomes).toEqual([{ label: 'Which countries?', status: 'filled' }]);
  });

  it('leaves the group untouched when the option is not one it offers', () => {
    const inputs = checkboxGroup('Which countries?', ['Germany', 'Poland']);

    const outcomes = fillByLabel(document, [{ label: 'Which countries?', value: 'Norfolk Island' }]);

    expect(inputs.some((i) => i.checked)).toBe(false);
    expect(outcomes).toEqual([{ label: 'Which countries?', status: 'no_option' }]);
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
