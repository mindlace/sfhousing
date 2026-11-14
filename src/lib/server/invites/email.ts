import { sendEmail } from '$lib/server/email/send';
import { buildInviteEmail } from '$lib/server/email-templates/invite';
import { recordE2eMail } from '$lib/server/e2e/mail-sink';

/** Send a sim invitation email. In an e2e env the link is also recorded in the mail sink
 *  (kind `invite`), since no HTTP response carries it. */
export async function sendInviteEmail(args: {
  platform: App.Platform;
  origin: string;
  to: string;
  token: string;
  inviterHandle: string;
  simTitle: string;
}): Promise<void> {
  const url = `${args.origin}/invite/${args.token}`;
  recordE2eMail(args.platform, 'invite', args.to, url);
  await sendEmail(args.platform, {
    to: args.to,
    ...(await buildInviteEmail({
      inviterHandle: args.inviterHandle,
      simTitle: args.simTitle,
      url
    }))
  });
}
