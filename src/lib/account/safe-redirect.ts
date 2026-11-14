/**
 * Sanitize a user-supplied post-auth redirect target (`returnTo` / `callbackURL`).
 *
 * Open-redirect guard: only same-origin paths are allowed through. Anything that
 * could send the browser to another origin (absolute URLs, protocol-relative
 * `//host`, backslash variants browsers normalize to `/`, or control characters
 * smuggled in to bypass the leading-slash check) collapses to `fallback`.
 *
 * Lives in `$lib` (not `$lib/server`) so the same rule runs on both the server
 * (`redirect()`, Better-Auth `callbackURL`) and the client (`window.location`).
 */
export function safeReturnTo(value: string | null | undefined, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;
  // Must be an absolute path, but not protocol-relative (`//host`).
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  // Reject backslashes (browsers treat `\` as `/`, so `/\evil.com` escapes origin)
  // and any control/whitespace chars that could be stripped to bypass the checks above.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return fallback;
  }
  return value;
}
