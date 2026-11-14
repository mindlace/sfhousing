export const AUTH_COPY = {
  pageTitle: 'Sign in',
  pageTitleSignup: 'Sign up',
  signIn: 'Sign in',
  signUp: 'Sign up',
  enterIdentifier: 'Enter your email or handle.',
  tooManySignin: 'Too many sign-in requests. Wait a moment.',
  signinFailed: "That handle and password don't match. Try again.",
  emailSent: 'Link sent. Check your email.',
  devLink: 'Open sign-in link (test only)',
  sending: 'Sending your link…',
  redirectingGoogle: 'Redirecting to Google…',
  passkeyWaiting: 'Waiting for your passkey…',
  passkeyFailed: "Passkey sign-in didn't go through. Try again.",
  googleError: "Google sign-in didn't go through. Try again.",
  linkFailed: 'That link has expired or was used. Send a new one.',
  passkeyButton: 'Sign in with a passkey',
  googleButton: 'Continue with Google',
  chooseOne: 'Choose one:',
  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  identifierLabel: 'Email or handle',
  identifierPlaceholder: 'you@example.com or your-handle',
  emailMeLink: 'Email me a link',
  usePassword: 'Use a password instead',
  passwordLabel: 'Password',
  passwordSubmit: 'Sign in',
  forgotPassword: 'Forgot your password?',
  passwordResetDone: 'Password updated. Sign in with your new password.',
  startFresh: 'Start fresh without an account',
  cancel: 'Cancel',
  forgotTitle: 'Reset your password',
  forgotHeading: 'Reset your password',
  forgotIntro:
    "Enter your handle or email address and we'll send you a link to choose a new password.",
  forgotIdentifierLabel: 'Email or handle',
  forgotSubmit: 'Email me a reset link',
  forgotSent: 'If that account can receive email, a reset link is on its way. Check your inbox.',
  backToSignin: 'Back to sign in',
  resetTitle: 'Choose a new password',
  resetHeading: 'Choose a new password',
  resetNewLabel: 'New password',
  resetConfirmLabel: 'Confirm new password',
  resetSubmit: 'Set new password',
  resetMismatch: "Those two passwords don't match.",
  resetInvalid: 'That reset link has expired or has already been used.',
  resetRequestAnother: 'Request a new reset link',
  passwordBreached:
    'That password has appeared in a known data breach. Please choose a different one.'
} as const;

export const passwordTooShort = (min: number): string =>
  `Use at least ${min} characters. Length matters more than symbols: a few plain words works well.`;
export const passwordTooLong = (max: number): string => `That's longer than ${max} characters.`;

export const pendingSimLine = (title: string): string => `Signing in to create ${title}`;
