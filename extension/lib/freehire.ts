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
