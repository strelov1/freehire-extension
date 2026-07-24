import { describe, it, expect } from 'vitest';
import { freehireSlugFromUrl } from './freehire';

describe('freehireSlugFromUrl', () => {
  it('extracts the slug from a freehire job URL', () => {
    expect(freehireSlugFromUrl('https://freehire.me/jobs/backend-engineer-stripe-abc')).toBe(
      'backend-engineer-stripe-abc',
    );
  });

  it('works on the dev host', () => {
    expect(freehireSlugFromUrl('http://localhost:5173/jobs/go-dev-acme-t35nijto')).toBe(
      'go-dev-acme-t35nijto',
    );
  });

  it('ignores sub-paths under a job', () => {
    expect(freehireSlugFromUrl('https://freehire.me/jobs/abc/similar')).toBeNull();
  });

  it('ignores non-job freehire pages', () => {
    expect(freehireSlugFromUrl('https://freehire.me/companies')).toBeNull();
  });

  it('ignores foreign hosts even with a /jobs/ path', () => {
    expect(freehireSlugFromUrl('https://jobright.ai/jobs/whatever')).toBeNull();
  });

  it('returns null for junk input', () => {
    expect(freehireSlugFromUrl('not a url')).toBeNull();
  });
});
