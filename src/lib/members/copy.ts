/** The most sims one person can manage. */
export const MAX_SIMS_PER_MANAGER = 5;
/** The longest sim title. */
export const SIM_TITLE_MAX = 63;

export const SIMS_COPY = {
  heading: 'Your sims',
  titleLabel: 'Sim title',
  create: 'Create',
  empty: 'No sims yet.',
  titleRequired: 'Give the sim a title.',
  tooManySims: 'Too many new sims too quickly. Wait a moment.',
  signInRequired: 'Sign in to create a sim.',
  sessionStart: "Couldn't start your session. Try again.",
  quota: `You can manage up to ${MAX_SIMS_PER_MANAGER} sims.`
} as const;

export const titleTooLong = (max: number): string => `Sim titles can be at most ${max} characters.`;
