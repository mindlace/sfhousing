/** Copy for the /account page, its panes and the account APIs. */
export const ACCOUNT_COPY = {
  pageTitle: 'Account',
  heading: 'Account',
  signOut: 'Sign out',
  loading: 'Loading…',
  loadFailed: "Couldn't load this. Reload to try again.",
  save: 'Save',
  cancel: 'Cancel',
  remove: 'Remove',

  profileHeading: 'Profile',
  handleLabel: 'Handle',
  handleHint: 'Letters, numbers and hyphens.',
  displayNameLabel: 'Display name',
  displayNameHint: 'Shown instead of your handle.',
  saved: 'Saved.',
  saveError: "Couldn't save. Try again.",

  authHeading: 'Sign-in',
  emailHeading: 'Email',
  emailLabel: 'Email',
  emailAddPrompt: 'Add an email to sign in again later.',
  sendLink: 'Send link',
  resendLink: 'Send again',
  devLink: 'Confirm email (test only)',
  newEmailLabel: 'New email',
  changeEmail: 'Change email',
  invalidEmail: 'Enter a valid email address.',

  passkeysHeading: 'Passkeys',
  passkeysDescription: 'Sign in with this device. No email or password.',
  noPasskeys: 'No passkeys yet.',
  passkeyDefaultName: 'Passkey',
  passkeyAdd: 'Add a passkey',
  passkeyAddError: "Couldn't add a passkey.",
  passkeyAdded: 'Passkey added.',
  passkeyRemoved: 'Passkey removed.',
  passkeyRemoveError: "Couldn't remove that passkey. Try again.",

  passwordHeading: 'Password',
  passwordDescription: 'Sign in with your handle and a password.',
  passwordSet: 'Set a password',
  passwordChange: 'Change password',
  passwordLabel: 'Password',
  passwordCurrentLabel: 'Current password',
  passwordNoRecovery: 'With no email, a forgotten password cannot be recovered.',
  passwordSetDone: 'Password set.',
  passwordChangedDone: 'Password changed. Other devices are signed out.',
  passwordRemovedDone: 'Password removed. Other devices are signed out.',
  passwordSetError: "Couldn't set that password. Try again.",
  passwordAlreadySet: 'You already have a password. Remove it first.',
  passwordCurrentRequired: 'Enter your current password.',
  passwordCurrentWrong: "That current password isn't right.",
  passwordLastFactor: 'This is your only way in. Add a passkey or confirm an email first.',
  passwordAddRecoveryNudge: 'Add a passkey or confirm an email as a way back in.',
  networkError: "Couldn't reach the server. Check your connection.",

  googleHeading: 'Google',
  googleConnected: 'Google connected.',
  googleConnectPrompt: 'Connect Google for one-tap sign-in.',
  googleConnect: 'Connect Google',

  deleteHeading: 'Delete account',
  deleteDescription:
    'Deletes your account. You leave every sim; their links still open. This cannot be undone.',
  deleteButton: 'Delete my account',
  deleteConfirmLabel: 'Type your handle to confirm',
  deletePermanently: 'Delete permanently',
  handleMismatch: 'That handle does not match.',

  signinRequired: 'Sign in first.',
  tooManyChanges: 'Too many changes. Wait a moment.',
  tooManyRequests: 'Too many requests. Wait a moment.',
  emailAlreadySet: 'Your email is already set.'
} as const;

export const passwordSignInAs = (handle: string): string => `You sign in as @${handle}.`;
export const emailSentTo = (email: string): string => `Link sent to ${email}. Open it to confirm.`;
export const emailConfirmed = (email: string): string => `${email} is confirmed.`;
export const emailUnconfirmed = (email: string): string => `${email} isn't confirmed.`;
export const emailChangeSent = (current: string, next: string): string =>
  `Check ${current} to approve the change to ${next}. A link then goes to the new address.`;
export const removePasskeyNamed = (name: string): string => `Remove passkey ${name}`;
export const deleteConfirmLine = (handle: string): string =>
  `Permanent. Type @${handle} to delete your account.`;
