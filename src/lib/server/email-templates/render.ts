import { Renderer, toPlainText } from '@better-svelte-email/server';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Stateless config — safe to instantiate once at module scope.
const renderer = new Renderer();

/**
 * Render a Svelte email component to `{ subject, html, text }`.
 * `html` is email-safe (Tailwind inlined); `text` is derived from it so the
 * plain-text alternative never drifts from the HTML.
 */
export async function renderEmail(
  component: unknown,
  props: Record<string, unknown>,
  subject: string
): Promise<RenderedEmail> {
  const html = await renderer.render(component, { props });
  return { subject, html, text: toPlainText(html) };
}
