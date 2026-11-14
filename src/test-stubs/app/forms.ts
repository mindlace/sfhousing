// Client-test stand-in for `$app/forms` (aliased in vite.config.client-test.ts only). Route
// component specs render forms without progressive enhancement: `enhance` attaches nothing, so
// a submit is the browser's own.
export function enhance(): { destroy(): void } {
  return { destroy() {} };
}
