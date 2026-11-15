export type DatasetDecision =
  { kind: 'edit' } | { kind: 'move' } | { kind: 'stop'; why: 'stale' | 'unknown-dataset' };

/** The dataset rule: page P, the local fold's dataset, the server's (null until a hello). */
export function datasetDecision(
  page: string,
  fold: string | null,
  server: string | null
): DatasetDecision {
  if (fold === null || fold === page) return { kind: 'edit' };
  if (server === null) return { kind: 'stop', why: 'unknown-dataset' };
  return server === page ? { kind: 'move' } : { kind: 'stop', why: 'stale' };
}
