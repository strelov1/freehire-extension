<script lang="ts">
  import {
    groupTitle,
    isExpandable,
    callLine,
    nonEmptyInput,
    previewToolInput,
    toolErrorMessage,
    type ToolCall,
  } from '../../lib/assistant/tool-formatters';
  import { pageReadTarget } from '../../lib/assistant/pageRead';

  // The tool calls of one assistant message, rendered as collapsed rows. Ported
  // from the web app's `ToolGroupList.svelte`; the formatting logic is shared
  // verbatim through `tool-formatters`, only the markup differs — the web has
  // Tailwind and an icon set, this panel has neither and is 400px wide.
  let { calls }: { calls: readonly ToolCall[] } = $props();

  // Fold the flat list into consecutive runs of the same tool, so a burst of
  // searches reads as one row rather than five.
  function groupTools(flat: readonly ToolCall[]): ToolCall[][] {
    const groups: ToolCall[][] = [];
    for (const c of flat) {
      const last = groups[groups.length - 1];
      if (last && last[0]?.name === c.name) last.push(c);
      else groups.push([c]);
    }
    return groups;
  }
</script>

{#each groupTools(calls) as g, t (t)}
  {@const title = groupTitle(g)}
  {#if !isExpandable(g)}
    <div class="tool">{title}</div>
  {:else}
    <details class="tool">
      <summary>{title}</summary>
      <ul>
        {#each g as c, ci (ci)}
          <li>
            <span class:err={c.isError}>{callLine(c)}</span>
            {#if pageReadTarget(c)}
              <!-- Which page was read, so a read the agent chose to make is one the
                   user can see. Query and fragment are dropped upstream. -->
              <code class="page">{pageReadTarget(c)}</code>
            {/if}
            {#if toolErrorMessage(c)}
              <span class="err">— {toolErrorMessage(c)}</span>
            {:else if nonEmptyInput(c.input)}
              <code>{previewToolInput(c.input)}</code>
            {/if}
          </li>
        {/each}
      </ul>
    </details>
  {/if}
{/each}

<style>
  .tool {
    align-self: flex-start;
    max-width: 90%;
    font-size: 12px;
    color: #6b7280;
    background: #f7f7f8;
    border: 1px solid #eee;
    border-radius: 8px;
    padding: 6px 10px;
  }

  summary {
    cursor: pointer;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  /* A disclosure the user can miss is a disclosure they will not open. */
  summary::after {
    content: ' ▸';
    color: #9ca3af;
  }

  details[open] summary::after {
    content: ' ▾';
  }

  ul {
    margin: 6px 0 0;
    padding-left: 14px;
    font-size: 11px;
    line-height: 1.5;
  }

  li {
    word-break: break-word;
  }

  code {
    background: #eef0f2;
    border-radius: 4px;
    padding: 1px 4px;
    font-family: ui-monospace, monospace;
  }

  .err {
    color: #b42318;
  }

  /* The page a read touched: quiet, but legible enough to notice a surprise. */
  .page {
    color: #4b5563;
    word-break: break-all;
  }
</style>
