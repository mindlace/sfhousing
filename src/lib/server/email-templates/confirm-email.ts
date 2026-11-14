import LinkActionEmail from './LinkActionEmail.svelte';
import { EMAIL_COPY } from './copy';
import { renderEmail, type RenderedEmail } from './render';

/** Build the "confirm your new email" email (sent to the NEW address). */
export function buildConfirmEmail(url: string): Promise<RenderedEmail> {
  const c = EMAIL_COPY.confirmEmail;
  return renderEmail(
    LinkActionEmail,
    { url, preview: c.preview, heading: c.heading, body: c.body, cta: c.cta },
    c.subject
  );
}
