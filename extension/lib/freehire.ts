import { HIRE_ORIGIN } from './auth';

/** Hosts whose /jobs/<slug> pages we recognise as freehire job postings.
 *
 * freehire.dev stays on purpose: it is the pre-migration domain, and a user can
 * still land on one of its job pages from an old link or bookmark. This list
 * recognises what a tab might show, so it must outlive the canonical domain. */
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

/** freehire's company-logo proxy URL for a company name (404s → placeholder).
 *
 * logo.freehire.me, matching the web app's COMPANY_LOGO_BASE. Both hosts serve,
 * so this was not broken — only divergent, and divergence is what leaves one of
 * two call sites behind on the next change. */
export function companyLogoUrl(company: string): string | null {
  const c = company.trim();
  return c ? `https://logo.freehire.me/${encodeURIComponent(c)}` : null;
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

/** What the agent did to the form it was pointed at. */
export interface AutofillReport {
  filled: string[];
  /** Custom-widget comboboxes — not fillable yet, reported rather than corrupted. */
  deferred: string[];
  /** Fields the agent found no basis for in the profile. */
  unmapped: string[];
}

/**
 * Asks freehire's agent to fill the form on the page the panel is looking at. The
 * agent drives this extension back over the browser-tool wire, so the panel's
 * ToolChannel has to be attached before this is called.
 */
export function runAgentAutofill(token: string): Promise<AutofillReport> {
  return postData<AutofillReport>('/api/v1/me/autofill/run', {}, token);
}

/** What the server did with a page we offered it. */
export type ResolveStatus = 'found' | 'imported' | 'queued';

export interface ResolvedPage {
  public_slug: string | null;
  status: ResolveStatus;
}

/**
 * Offers the page to freehire: the server answers with the catalog posting for it,
 * importing the vacancy when it can read the page and queueing the link for a
 * maintainer when it cannot. Authenticated — it makes the server fetch the URL.
 */
export function resolveJob(url: string, token: string): Promise<ResolvedPage> {
  return postData<ResolvedPage>('/api/v1/jobs/resolve', { url }, token);
}

/** The sentence the panel shows for each outcome. Pure. */
export function resolveNotice(status: ResolveStatus): string {
  switch (status) {
    case 'imported':
      return '✓ Added to freehire — here is your match.';
    case 'found':
      return 'freehire already had this posting — here is your match.';
    case 'queued':
      return "We could not read this page, so we'll have a look at the link.";
    default:
      return 'Sent this page to freehire.';
  }
}

/**
 * Resolves the page's URL to a freehire catalog slug, or null when the posting
 * is not one we carry (or is on an ATS the server cannot yet read a job id
 * from). The server matches on the posting's own identity in the URL; it used to
 * take a company and a guessed title, which was both unreliable and slow enough
 * to time out.
 */
export async function findJob(url: string, token: string): Promise<string | null> {
  const found = await getData<{ public_slug: string } | null>(
    `/api/v1/jobs/find?url=${encodeURIComponent(url)}`,
    token,
  );
  return found?.public_slug ?? null;
}
