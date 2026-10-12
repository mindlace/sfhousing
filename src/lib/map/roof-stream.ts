/** Read decoded HTTP bytes into a bounded allocation; Content-Length is never the boundary. */
export async function readRoofBytes(
  response: Response,
  limit: number,
  signal: AbortSignal,
  exact?: number
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok || !response.body) throw new Error(`roof HTTP ${response.status}`);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    (exact !== undefined && (exact < 0 || exact > limit))
  )
    throw new Error('roof byte bound');
  const reader = response.body.getReader();
  const output = new Uint8Array(exact ?? limit);
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (length + value.byteLength > output.length)
        throw new Error('roof stream exceeds byte bound');
      output.set(value, length);
      length += value.byteLength;
    }
    if (exact !== undefined && length !== exact) throw new Error('truncated roof stream');
    return length === output.length ? output : output.slice(0, length);
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
