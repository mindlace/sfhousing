import LinkActionEmail from './LinkActionEmail.svelte';
import { EMAIL_COPY } from './copy';
import { renderEmail, type RenderedEmail } from './render';

/** Build the branded password-reset email. */
export function buildResetPasswordEmail(url: string): Promise<RenderedEmail> {
  const c = EMAIL_COPY.resetPassword;
  return renderEmail(
    LinkActionEmail,
    { url, preview: c.preview, heading: c.heading, body: c.body, cta: c.cta },
    c.subject
  );
}
