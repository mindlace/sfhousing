// Client-test stand-in for `$app/forms` (aliased in vite.config.client-test.ts only). Route
// component specs render forms without progressive enhancement: `enhance` attaches nothing, so
// a submit is the browser's own. The submit function a form passed is kept in `enhanced`, so a
// spec can drive what the page does with an action's result.
export const enhanced = new Map<HTMLFormElement, unknown>();

export function enhance(form: HTMLFormElement, submit?: unknown): { destroy(): void } {
  if (submit) enhanced.set(form, submit);
  return {
    destroy() {
      enhanced.delete(form);
    }
  };
}
