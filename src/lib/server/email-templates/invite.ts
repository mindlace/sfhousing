import InviteEmail from './InviteEmail.svelte';
import { EMAIL_COPY } from './copy';
import { renderEmail, type RenderedEmail } from './render';

/** Build the branded sim invitation email. */
export function buildInviteEmail(args: {
  inviterHandle: string;
  simTitle: string;
  url: string;
}): Promise<RenderedEmail> {
  return renderEmail(
    InviteEmail,
    { inviterHandle: args.inviterHandle, simTitle: args.simTitle, url: args.url },
    EMAIL_COPY.invite.subject(args.inviterHandle, args.simTitle)
  );
}
