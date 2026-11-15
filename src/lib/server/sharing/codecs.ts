// The kind -> codec map the server uses to tell a row's document from the one a route expects.
// Server-side so doc-codec.ts (which sim-doc.ts imports) need not import sim-doc.ts back. Policies
// are schema 4 (timeline-ui Task 15): publish takes schema 4 only; stored rows of every schema load.
import { PLAN_CODEC, type DocCodec, type DocKind } from '$lib/sharing/doc-codec';
import { SIM_SERVER_CODEC4 } from '$lib/timeline/server-codec';

export const CODECS: Record<DocKind, DocCodec<unknown>> = {
  plan: PLAN_CODEC as DocCodec<unknown>,
  sim: SIM_SERVER_CODEC4 as DocCodec<unknown>
};

/** The codec of the other document kind (there are two). */
export function otherCodec(kind: DocKind): DocCodec<unknown> {
  return kind === 'plan' ? CODECS.sim : CODECS.plan;
}
