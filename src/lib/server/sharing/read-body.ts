// Streams a request body with a hard byte cap. Content-Length is never trusted: the cap is
// enforced on bytes actually read, and the stream is cancelled as soon as it is exceeded.

export type CappedBody = { ok: true; text: string } | { ok: false; reason: 'too_large' };

/**
 * Reads request.body as a stream; cancels and returns too_large once more than `max` bytes are
 * read. Never trusts Content-Length. Empty body → ok ''.
 */
export async function readCapped(request: Request, max: number): Promise<CappedBody> {
  if (!request.body) return { ok: true, text: '' };
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return { ok: false, reason: 'too_large' };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { ok: true, text };
}
