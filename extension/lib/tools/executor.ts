/**
 * The extension's half of the browser-tool wire: it turns a `ToolCall` into a
 * `ToolResult` by driving a `PageBridge`. Pure over the bridge — the chrome
 * plumbing that actually reaches the tab's frames lives in `page.ts`, so the
 * dispatch, the argument validation and the error contract are testable without
 * a browser.
 */

import type { LabelFill, FillOutcome, FillStatus } from '../protocol';
import type { FramedField, ToolCall, ToolResult } from './wire';

/** Whatever can read and write the page the user is looking at. */
export interface PageBridge {
  /** Every frame's fillable controls, each tagged with its frame. */
  readForm(): Promise<FramedField[]>;
  /** Applies the fills across the page's frames, one outcome per requested fill. */
  fillSimple(fills: LabelFill[]): Promise<FillOutcome[]>;
}

/**
 * Runs one tool call. Never throws: an unknown tool, bad arguments, or a failing
 * bridge all come back as an error result tagged with the call id, because the
 * harness on the other end is waiting on that id and silence would hang it.
 */
export async function executeTool(call: ToolCall, page: PageBridge): Promise<ToolResult> {
  try {
    switch (call.tool) {
      case 'read_form':
        return { id: call.id, result: { fields: await page.readForm() } };
      case 'fill_simple': {
        const fills = readFills(call.args);
        return { id: call.id, result: { outcomes: await page.fillSimple(fills) } };
      }
      default:
        return { id: call.id, error: `unknown tool: ${call.tool}` };
    }
  } catch (err) {
    return { id: call.id, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Validates `fill_simple`'s arguments, throwing the message the caller sees. */
function readFills(args: Record<string, unknown> | undefined): LabelFill[] {
  const fills = args?.fills;
  if (!Array.isArray(fills)) throw new Error('fill_simple requires args.fills: [{label, value}]');
  return fills.map((f) => {
    const { label, value } = (f ?? {}) as Record<string, unknown>;
    if (typeof label !== 'string' || !label) throw new Error('every fill needs a non-empty label');
    return { label, value: typeof value === 'string' ? value : String(value ?? '') };
  });
}

// A frame that does not contain the field reports `not_found`, so across frames
// the informative answer must win over the many negatives. Ordered least to most
// informative; ties keep the first frame that reported it.
const STATUS_RANK: Record<FillStatus, number> = {
  not_found: 0,
  no_option: 1,
  deferred_combobox: 2,
  filled: 3,
};

/** Folds each frame's outcomes into one answer per requested label. */
export function mergeFrameOutcomes(perFrame: FillOutcome[][]): FillOutcome[] {
  const best = new Map<string, FillOutcome>();
  for (const outcomes of perFrame) {
    for (const outcome of outcomes) {
      const seen = best.get(outcome.label);
      if (!seen || STATUS_RANK[outcome.status] > STATUS_RANK[seen.status]) {
        best.set(outcome.label, outcome);
      }
    }
  }
  return [...best.values()];
}
