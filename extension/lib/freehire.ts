import { HIRE_ORIGIN } from './auth';

/** Hosts whose /jobs/<slug> pages we recognise as freehire job postings. */
const JOB_HOSTS = ['freehire.me', 'www.freehire.me', 'freehire.dev', 'localhost'];

/**
 * Returns the freehire job slug for a page URL, or null if the URL is not a
 * freehire job posting. Pure over its input.
 */
export function freehireSlugFromUrl(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!JOB_HOSTS.includes(u.hostname)) return null;
  const m = u.pathname.match(/^\/jobs\/([^/]+)\/?$/);
  return m ? m[1] : null;
}

/**
 * Best-effort (company, title) for an arbitrary job page, used to look the
 * posting up in the freehire catalog. Pure. Company comes from a greenhouse
 * `?for=` hint or a "<title> at <Company>" headline; title strips common apply
 * prefixes and the trailing "at <Company>".
 */
export function guessJobIdentity(
  rawUrl: string,
  headline: string,
): { company: string; title: string } {
  let company = '';
  try {
    company = new URL(rawUrl).searchParams.get('for') ?? '';
  } catch {
    // ignore unparseable URL
  }

  let title = (headline ?? '').trim();
  title = title.replace(/^(job application for|application for|apply (?:for|to))\s+/i, '');
  const at = title.match(/^(.*?)\s+at\s+(.+)$/i);
  if (at) {
    title = at[1].trim();
    if (!company) company = at[2].trim();
  }
  return { company: company.trim(), title: title.trim() };
}

/** freehire's company-logo proxy URL for a company name (404s → placeholder). */
export function companyLogoUrl(company: string): string | null {
  const c = company.trim();
  return c ? `https://logo.freehire.dev/${encodeURIComponent(c)}` : null;
}

/** The slice of a freehire job the card renders. */
export interface FreehireJob {
  public_slug: string;
  title: string;
  company: string;
  location: string;
  posted_at?: string | null;
}

/** Deterministic skill-coverage match against the signed-in user's profile. */
export interface JobMatch {
  coverage_percent: number;
  total: number;
  matched: string[];
  adjacent: { skill: string }[];
  missing: string[];
}

async function getData<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${HIRE_ORIGIN}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`${path} → HTTP ${res.status}`);
  }
  return ((await res.json()) as { data: T }).data;
}

async function postData<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${HIRE_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${path} → HTTP ${res.status}`);
  }
  return ((await res.json()) as { data: T }).data;
}

export function getJob(slug: string, token: string): Promise<FreehireJob> {
  return getData<FreehireJob>(`/api/v1/jobs/${encodeURIComponent(slug)}`, token);
}

export function getMatch(slug: string, token: string): Promise<JobMatch> {
  return getData<JobMatch>(`/api/v1/jobs/${encodeURIComponent(slug)}/match`, token);
}

/**
 * Ad-hoc match for a job posting scraped off any page — no catalog job needed.
 * The server extracts skills from title+text and scores them against the profile.
 */
export function getMatchText(title: string, text: string, token: string): Promise<JobMatch> {
  return postData<JobMatch>('/api/v1/me/match-text', { title, text }, token);
}

/** Canonical autofill fields freehire assembles from the user's CV + account. */
export interface AutofillProfile {
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
}

export function getAutofillProfile(token: string): Promise<AutofillProfile> {
  return getData<AutofillProfile>('/api/v1/me/autofill-profile', token);
}

/** Resolves a posting to a freehire catalog slug by company + title, or null. */
export async function findJob(company: string, title: string, token: string): Promise<string | null> {
  const q = `company=${encodeURIComponent(company)}&title=${encodeURIComponent(title)}`;
  const found = await getData<{ public_slug: string } | null>(`/api/v1/jobs/find?${q}`, token);
  return found?.public_slug ?? null;
}
