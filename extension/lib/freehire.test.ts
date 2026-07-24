import { describe, it, expect } from 'vitest';
import { freehireSlugFromUrl, guessJobIdentity } from './freehire';

describe('guessJobIdentity', () => {
  it('parses a greenhouse application page (company from ?for, title from headline)', () => {
    const got = guessJobIdentity(
      'https://job-boards.greenhouse.io/embed/job_app?for=stripe&jr_id=123',
      'Job Application for Backend Engineer, AI Security at Stripe',
    );
    expect(got).toEqual({ company: 'stripe', title: 'Backend Engineer, AI Security' });
  });

  it('parses "<title> at <Company>" when there is no url hint', () => {
    const got = guessJobIdentity('https://acme.com/careers/42', 'Senior Go Engineer at Acme');
    expect(got).toEqual({ company: 'Acme', title: 'Senior Go Engineer' });
  });

  it('leaves company empty when unknown', () => {
    const got = guessJobIdentity('https://example.com/x', 'Backend Developer');
    expect(got).toEqual({ company: '', title: 'Backend Developer' });
  });
});

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
