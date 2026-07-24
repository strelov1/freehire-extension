// TypeScript mirror of the Roy control protocol (`ClientCommand`/`ServerEvent`)
// and the `TurnEvent` enum, ported from the freehire web assistant
// (`web/src/lib/assistant/wire.ts`). Roy (`freehire-agent`) speaks this protocol
// verbatim over its `/ws` relay: the client sends `ClientCommand` JSON and
// receives `ServerEvent` JSON, one JSON value per WebSocket message. The backend
// is the source of truth for this shape; this port is thin and read-only.

/** The literal marker offered as the first WebSocket subprotocol, alongside the
 *  JWT as the second — how the cross-origin extension authenticates to Roy's
 *  `/ws` (browsers can't set custom headers on a WS upgrade). Roy echoes only
 *  this marker back, never the token. */
export const WS_SUBPROTOCOL_MARKER = 'roy-jwt';

export type Seq = number;

// ---- TurnEvent (tag: "type") ---------------------------------------------

export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled'
  | 'error'
  | (string & {});

export type TurnEvent =
  | { type: 'system'; subtype: string }
  | { type: 'user_prompt'; text: string }
  | { type: 'note'; text: string; source_session: string | null }
  | { type: 'assistant_text'; text: string }
  | { type: 'assistant_thought'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | {
      type: 'usage';
      input_tokens: number | null;
      output_tokens: number | null;
      cost_usd: number | null;
    }
  | {
      type: 'result';
      cost_usd: number | null;
      stop_reason: StopReason;
      is_error: boolean;
    }
  | { type: 'raw'; value: unknown };

export interface JournalEntry {
  seq: Seq;
  /// Wall-clock millis since epoch, stamped by the daemon when the entry hit
  /// the journal.
  ts_ms: number;
  event: TurnEvent;
}

// ---- ClientCommand (tag: "op") -------------------------------------------

export type ClientCommand =
  | { op: 'attach'; session: string; from_seq?: Seq }
  | { op: 'acquire_input'; session: string }
  | { op: 'send'; session: string; text: string }
  | { op: 'cancel_turn'; session: string }
  | { op: 'release_input'; session: string }
  | { op: 'detach'; session: string };

// ---- ServerEvent (tag: "kind") -------------------------------------------

export type ErrorCode =
  | 'bad_request'
  | 'forbidden'
  | 'no_session'
  | 'attach_failed'
  | 'no_lease'
  | 'send_failed'
  | 'cancel_failed'
  | (string & {});

export type ServerEvent =
  | { kind: 'resuming'; session: string }
  | {
      kind: 'attached';
      session: string;
      seq_at_attach: Seq;
      harness: string;
      model?: string;
    }
  | { kind: 'frame'; session: string; entry: JournalEntry }
  | { kind: 'input_acquired'; session: string; acquired: boolean }
  | { kind: 'input_released'; session: string }
  | { kind: 'detached'; session: string }
  | { kind: 'error'; session?: string; code: ErrorCode; message: string };

export type ServerEventKind = ServerEvent['kind'];
