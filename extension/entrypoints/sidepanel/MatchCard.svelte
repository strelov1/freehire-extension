<script lang="ts">
  import { companyLogoUrl, type FreehireJob, type JobMatch } from '../../lib/freehire';

  let { job, match }: { job: FreehireJob; match: JobMatch } = $props();

  let pct = $derived(Math.max(0, Math.min(100, match.coverage_percent)));
  let color = $derived(pct >= 70 ? '#4d7c0f' : pct >= 40 ? '#a16207' : '#b42318');
  let logoUrl = $derived(companyLogoUrl(job.company));
  let monogram = $derived((job.company || job.title || '?').trim().charAt(0).toUpperCase());
  let logoFailed = $state(false);
</script>

<div class="card">
  <div class="job">
    {#key job.company}
      <div class="logo">
        {#if logoUrl && !logoFailed}
          <img src={logoUrl} alt="" onerror={() => (logoFailed = true)} />
        {:else}
          <span class="monogram">{monogram}</span>
        {/if}
      </div>
    {/key}
    <div class="jobmeta">
      {#if job.company}<div class="company">{job.company}</div>{/if}
      <div class="title">{job.title}</div>
    </div>
  </div>

  <div class="mrow">
    <span class="label">Profile match</span>
    <span class="count">{match.matched.length} of {match.total} skills</span>
  </div>
  <div class="pct" style="color:{color}">{pct}%</div>
  <div class="bar"><div class="fill" style="width:{pct}%; background:{color}"></div></div>

  <div class="group">
    <div class="glabel"><span class="dot good"></span> You have</div>
    <div class="chips">
      {#each match.matched as s}<span class="chip good">{s}</span>{/each}
      {#if match.matched.length === 0}<span class="none">no matching skills yet</span>{/if}
    </div>
  </div>

  {#if match.missing.length > 0}
    <div class="group">
      <div class="glabel"><span class="dot miss"></span> Missing</div>
      <div class="chips">
        {#each match.missing as s}<span class="chip miss">{s}</span>{/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .card {
    border: 1px solid #e5e5e5;
    border-radius: 12px;
    padding: 14px;
    margin: 12px;
    background: #fff;
  }
  .job {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .logo {
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #eee;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f7f7f8;
  }
  .logo img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .monogram {
    font-size: 16px;
    font-weight: 700;
    color: #6b7280;
  }
  .jobmeta {
    min-width: 0;
  }
  .company {
    font-size: 12px;
    color: #6b7280;
  }
  .title {
    font-size: 15px;
    font-weight: 700;
    line-height: 1.25;
    margin-top: 2px;
  }
  .mrow {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6b7280;
    font-weight: 600;
  }
  .count {
    font-size: 12px;
    color: #9ca3af;
  }
  .pct {
    font-size: 30px;
    font-weight: 800;
    line-height: 1.1;
    margin: 2px 0 8px;
  }
  .bar {
    height: 8px;
    border-radius: 999px;
    background: #eef0f2;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: 999px;
    transition: width 0.3s ease;
  }
  .group {
    margin-top: 12px;
  }
  .glabel {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #374151;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }
  .dot.good {
    background: #4d7c0f;
  }
  .dot.miss {
    background: #9ca3af;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 6px;
  }
  .chip {
    font-size: 12px;
    padding: 3px 9px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .chip.good {
    background: #ecfccb;
    color: #3f6212;
    border: 1px solid #d9f0a3;
  }
  .chip.miss {
    background: #f3f4f6;
    color: #6b7280;
    border: 1px solid #e5e7eb;
  }
  .none {
    font-size: 12px;
    color: #9ca3af;
  }
</style>
