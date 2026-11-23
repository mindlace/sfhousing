import { PRODUCT_NAME } from '../auth/brand';

/** Subjects and body text of the auth emails; the specs assert on these. */
export const EMAIL_COPY = {
  wordmark: PRODUCT_NAME,
  layoutFooter: `You received this email because someone used this address on ${PRODUCT_NAME}.`,
  linkFooter:
    "This link expires in 15 minutes. If you didn't request it, you can ignore this email.",
  signIn: {
    subject: `Your ${PRODUCT_NAME} sign in link`,
    preview: `Your sign in link for ${PRODUCT_NAME}`,
    heading: `Sign in to ${PRODUCT_NAME}`,
    body: 'Click the button below to sign in.',
    cta: 'Sign in'
  },
  resetPassword: {
    subject: `Reset your ${PRODUCT_NAME} password`,
    preview: `Reset your ${PRODUCT_NAME} password`,
    heading: 'Reset your password',
    body: 'Click the button below to choose a new password. If you did not ask for this, you can ignore this email.',
    cta: 'Choose a new password'
  },
  changeApprove: {
    subject: `Approve your ${PRODUCT_NAME} email change`,
    preview: `Approve your email change for ${PRODUCT_NAME}`,
    heading: 'Approve your email change',
    body: (newEmail: string) =>
      `Click below to approve changing your ${PRODUCT_NAME} email to ${newEmail}. We'll then send a confirmation link to that new address.`,
    cta: 'Approve change',
    footer:
      "This link expires in 15 minutes. If you didn't request it, you can ignore this email and your address stays the same."
  },
  confirmEmail: {
    subject: `Confirm your new ${PRODUCT_NAME} email`,
    preview: `Confirm your new email for ${PRODUCT_NAME}`,
    heading: 'Confirm your new email',
    body: `Click below to confirm this is your new ${PRODUCT_NAME} email address.`,
    cta: 'Confirm email'
  }
} as const;
