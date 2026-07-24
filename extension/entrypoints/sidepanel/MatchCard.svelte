<script lang="ts">
  import type { FreehireJob, JobMatch } from '../../lib/freehire';

  let { job, match }: { job: FreehireJob; match: JobMatch } = $props();

  // Ring geometry.
  const R = 22;
  const C = 2 * Math.PI * R;
  let pct = $derived(Math.max(0, Math.min(100, match.coverage_percent)));
  let dash = $derived((pct / 100) * C);
  // Green when strong, amber mid, red when weak — mirrors the reference feel.
  let color = $derived(pct >= 70 ? '#1a8917' : pct >= 40 ? '#c47d09' : '#b42318');
</script>

<div class="card">
  <div class="head">
    <div class="meta">
      <div class="company">{job.company}</div>
      <div class="title">{job.title}</div>
      {#if job.location}<div class="loc">{job.location}</div>{/if}
    </div>
    <div class="ring" title="Skill coverage of your profile">
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={R} fill="none" stroke="#eee" stroke-width="5" />
        <circle
          cx="28"
          cy="28"
          r={R}
          fill="none"
          stroke={color}
          stroke-width="5"
          stroke-linecap="round"
          stroke-dasharray="{dash} {C}"
          transform="rotate(-90 28 28)"
        />
        <text x="28" y="32" text-anchor="middle" font-size="14" font-weight="700" fill="#111">
          {pct}%
        </text>
      </svg>
    </div>
  </div>

  <div class="skills">
    <div class="group">
      <span class="lbl">Matched ({match.matched.length})</span>
      <div class="chips">
        {#each match.matched.slice(0, 10) as s}
          <span class="chip good">{s}</span>
        {/each}
        {#if match.matched.length === 0}<span class="none">—</span>{/if}
      </div>
    </div>
    {#if match.missing.length > 0}
      <div class="group">
        <span class="lbl">Missing ({match.missing.length})</span>
        <div class="chips">
          {#each match.missing.slice(0, 10) as s}
            <span class="chip miss">{s}</span>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .card {
    border: 1px solid #e5e5e5;
    border-radius: 10px;
    padding: 12px;
    margin: 12px;
    background: #fff;
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }
  .company {
    font-size: 12px;
    color: #666;
  }
  .title {
    font-size: 15px;
    font-weight: 700;
    line-height: 1.25;
    margin-top: 2px;
  }
  .loc {
    font-size: 12px;
    color: #999;
    margin-top: 2px;
  }
  .ring {
    flex: none;
  }
  .skills {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .lbl {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #888;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .chip {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .chip.good {
    background: #e7f6e7;
    color: #1a6f16;
  }
  .chip.miss {
    background: #f1f1f1;
    color: #666;
  }
  .none {
    font-size: 12px;
    color: #aaa;
  }
</style>
