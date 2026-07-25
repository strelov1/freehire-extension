## 1. Establish that widgets can be driven at all

- [x] 1.1 Throwaway probe, in a real Chrome with the extension loaded, against the live Stripe and Scout Motors forms: can a react-select be opened, its options read, and one committed with events an injected script can dispatch? Record what each widget responds to.
      **Yes.** `pointerdown`+`mousedown`+`mouseup`+`click` on the `[class*="-control"]` node (not the input) opens it; the same sequence on a `[role="option"]` node commits that option and closes the widget. Verified across Stripe's 13 and Scout's 27 widgets. Two caveats found: React 18 re-renders asynchronously, so opening must be *awaited*, not read back synchronously; and a widget's own listbox is addressed by its `aria-controls` id, which only exists while open — a page-wide `[role=option]` sweep would return a *neighbouring* widget's options.
- [x] 1.2 Find where the committed value is readable — the widget's own displayed value, not the input's `value` — so verification cannot report a success that did not happen.
      The widget's own `[class*="singleValue"]` node. `input.value` is the empty string after a successful commit on every widget probed, and no hidden input mirrors the value. Also: the committed text is not always the option text — the phone-code widget commits `+358` for the option `Åland Islands +358`, so verification compares by one-directional containment (**committed ⊆ selected option**). The reverse direction would let the spike's original failure pass, since `No` ⊆ `Norfolk Island`.
- [x] 1.3 Verdict before building: drivable → continue; not drivable → stop and bring the CDP/`debugger` trade-off back as an explicit decision.
      **VALIDATED** — drivable with ordinary events; the CDP seam stays unpaid. Out-of-scope typeahead widgets identify themselves: they open and offer zero `role=option` nodes (Stripe "Location (City)") or a single "Loading..." node (Scout "School"), so they need no special case.

## 2. Observation: options and grouping

- [ ] 2.1 `form.ts`: read a combobox's offered options where they are exposed without opening; report them on the field.
- [ ] 2.2 `form.ts`: group controls answering one question (shared `fieldset`/`legend` or equivalently labelled container) into one field carrying the question's label and its options; leave ungrouped anything whose structure is not clearly one question. Unit-test both directions.
- [ ] 2.3 `read_form` carries the new shape (widget options, grouped field); `fill_simple` fills a grouped field by option text and refuses an option the group does not offer.

## 3. `combobox.*` primitives

- [ ] 3.1 `combobox.open` — reveal the listbox by label; report open / did-not-open / not-found.
- [ ] 3.2 `combobox.options` — return the offered option texts; nothing when the widget is not open.
- [ ] 3.3 `combobox.select` — commit an offered option by acting on the option; refuse a value the widget does not offer.
- [ ] 3.4 `combobox.verify` — read back the widget's committed value; a mismatch is a failure, never a fill.
- [ ] 3.5 Unit-test the four against a react-select-shaped fixture, including the mismatch path.

## 4. Agent loop

- [ ] 4.1 For each widget field in the plan: open → options → choose the option the profile justifies → select → verify. An unverified write is reported as not filled.
- [ ] 4.2 Grounding applies to the chosen option exactly as to a typed value; a question the profile does not answer selects nothing.
- [ ] 4.3 The report names each grouped question once, and distinguishes filled / not-yet-fillable / left-for-you.

## 5. Verify

- [ ] 5.1 Extension: `vitest run` + `svelte-check` + `wxt build`; hire: agent tests green.
- [ ] 5.2 Live end-to-end on the same two Greenhouse forms used as the baseline (Stripe: 4 filled / 13 widgets + 1 group; Scout Motors: 6 filled / 27 widgets). Record the new numbers; nothing is submitted.
- [ ] 5.3 Confirm no new permission: the built manifest asks for no `debugger`, and Chrome shows no debugging banner while autofill runs.
