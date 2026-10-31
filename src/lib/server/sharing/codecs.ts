// The kind -> codec map the server uses to tell a row's document from the one a route expects.
// Server-side so doc-codec.ts (which sim-doc.ts imports) need not import sim-doc.ts back.
import { PLAN_CODEC, type DocCodec, type DocKind } from '$lib/sharing/doc-codec';
import { SIM_CODEC } from '$lib/sim-page/sim-doc';

export const CODECS: Record<DocKind, DocCodec<unknown>> = {
  plan: PLAN_CODEC as DocCodec<unknown>,
  sim: SIM_CODEC as DocCodec<unknown>
};

/** The codec of the other document kind (there are two). */
export function otherCodec(kind: DocKind): DocCodec<unknown> {
  return kind === 'plan' ? CODECS.sim : CODECS.plan;
}
