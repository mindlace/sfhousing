import { PSEUDONYMOUS_EMAIL_DOMAIN } from '$lib/server/auth/brand';

/** The env keys that pick and configure a mail provider (secrets, read through a cast). */
export type MailEnv = {
  EMAIL_PROVIDER?: string;
  SES_ACCESS_KEY_ID?: string;
  SES_SECRET_ACCESS_KEY?: string;
  RESEND_API_KEY?: string;
};

export type MailProvider = 'ses' | 'resend';

/**
 * The provider `sendEmail` sends through, or null when it would run in log mode.
 * `EMAIL_PROVIDER=resend` needs `RESEND_API_KEY`; anything else is SES and needs
 * `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY`. `sendEmail` and the sign-in method
 * switch both decide through this one function.
 */
export function mailProvider(env: MailEnv): MailProvider | null {
  if ((env.EMAIL_PROVIDER ?? 'ses').toLowerCase() === 'resend') {
    return env.RESEND_API_KEY ? 'resend' : null;
  }
  return env.SES_ACCESS_KEY_ID && env.SES_SECRET_ACCESS_KEY ? 'ses' : null;
}

/** True when mail would actually be delivered (a provider is configured). */
export function mailCanBeDelivered(platform: App.Platform | undefined): boolean {
  return mailProvider((platform?.env ?? {}) as MailEnv) !== null;
}

/** False for an address no mail can reach: a pseudonymous account's synthetic address. */
export function isDeliverable(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.toLowerCase().split('@').pop()?.trim();
  return !!domain && domain !== PSEUDONYMOUS_EMAIL_DOMAIN;
}
