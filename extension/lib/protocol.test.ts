import { describe, it, expect } from 'vitest';
import { parseServerEvent, emptySnapshot } from './protocol';

describe('parseServerEvent', () => {
  it('accepts a well-formed assistant_message', () => {
    expect(parseServerEvent({ type: 'assistant_message', text: 'hi' })).toEqual({
      type: 'assistant_message',
      text: 'hi',
    });
  });

  it('rejects unknown types', () => {
    expect(parseServerEvent({ type: 'something_else', text: 'hi' })).toBeNull();
  });

  it('rejects a missing or non-string text', () => {
    expect(parseServerEvent({ type: 'assistant_message' })).toBeNull();
    expect(parseServerEvent({ type: 'assistant_message', text: 42 })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(parseServerEvent(null)).toBeNull();
    expect(parseServerEvent('assistant_message')).toBeNull();
  });
});

describe('emptySnapshot', () => {
  it('is all-empty', () => {
    expect(emptySnapshot()).toEqual({ url: '', title: '', headline: '', text: '' });
  });
});
