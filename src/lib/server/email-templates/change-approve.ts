import LinkActionEmail from './LinkActionEmail.svelte';
import { EMAIL_COPY } from './copy';
import { renderEmail, type RenderedEmail } from './render';

/** Build the "approve your email change" email (sent to the CURRENT address). */
export function buildChangeApprove(url: string, newEmail: string): Promise<RenderedEmail> {
  const c = EMAIL_COPY.changeApprove;
  return renderEmail(
    LinkActionEmail,
    {
      url,
      preview: c.preview,
      heading: c.heading,
      body: c.body(newEmail),
      cta: c.cta,
      footer: c.footer
    },
    c.subject
  );
}
