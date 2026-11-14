import LinkActionEmail from './LinkActionEmail.svelte';
import { EMAIL_COPY } from './copy';
import { renderEmail, type RenderedEmail } from './render';

/** Build the branded sign-in (magic-link) email. */
export function buildSignInEmail(url: string): Promise<RenderedEmail> {
  const c = EMAIL_COPY.signIn;
  return renderEmail(
    LinkActionEmail,
    { url, preview: c.preview, heading: c.heading, body: c.body, cta: c.cta },
    c.subject
  );
}
