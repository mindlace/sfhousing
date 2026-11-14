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
  jsonRequired: 'Send JSON.',
  crossOrigin: 'Cross-site requests are not allowed.',
  signInRequired: 'Sign in to create a sim.',
  sessionStart: "Couldn't start your session. Try again.",
  quota: `You can manage up to ${MAX_SIMS_PER_MANAGER} sims.`
} as const;

export const titleTooLong = (max: number): string => `Sim titles can be at most ${max} characters.`;

export const MEMBERS_COPY = {
  // The invite page.
  invitePageTitle: 'Invitation',
  inviteInvalidTitle: 'Invitation not valid',
  inviteInvalid: 'This invitation is no longer valid',
  inviteCheckEmail: 'Check your email for a link to finish joining',
  inviteAccept: 'Accept invitation',
  inviteEmailLabel: 'How can we reach you?',
  inviteJoinSim: 'Join sim',
  acceptFailed: 'accept failed',
  joinFailed: 'join failed',
  createAccountFailed: 'Could not create your account. Try signing in instead.',
  // Invitations addressed to the signed-in user.
  invitationsDeclinedToast: 'Invitation declined',
  invitationsAcceptFailedToast: "Couldn't accept that invitation. Try again.",
  invitationsActionFailedToast: "That didn't go through. Try again.",
  // The member list and invite form.
  membersPending: 'Pending',
  membersResend: 'resend',
  membersRevoke: 'revoke',
  membersInvitePlaceholder: 'email or @handle',
  membersInviteLabel: 'Invite by email or handle',
  // The leave flow.
  leaveButton: 'Leave sim',
  leaveSoleMemberWarning:
    "You're the only member. Leaving will permanently delete this sim and all its data.",
  leaveDeleteButton: 'Leave & delete sim',
  leaveCancel: 'Cancel',
  leaveSuccessorLabel: 'Who takes over?',
  leaveSuccessorAuto: 'Let the app choose',
  leaveHandoffButton: 'Hand off & leave',
  leaveConfirmTitleLabel: 'Type the sim title to confirm',
  leaveSimplePrompt: 'Leave this sim?',
  leaveSimpleButton: 'Leave',
  leaveFailed: 'Leave failed',
  // Server answers.
  inviteTargetRequired: 'target required',
  inviteFailed: 'invite failed',
  resendFailed: 'resend failed',
  notSignedIn: 'not signed in'
} as const;

export const inviteHeading = (handle: string, simTitle: string): string =>
  `@${handle} invited you to "${simTitle}"`;
export const invitationsRow = (handle: string, simTitle: string): string =>
  `@${handle} invited you to ${simTitle}`;
export const invitationsAcceptNamed = (simTitle: string): string =>
  `Accept invitation to ${simTitle}`;
export const invitationsDeclineNamed = (simTitle: string): string =>
  `Decline invitation to ${simTitle}`;
export const membersRemoveNamed = (handle: string): string => `Remove ${handle} from the sim`;
export const membersResendNamed = (display: string): string => `Resend invitation to ${display}`;
export const membersRevokeNamed = (display: string): string => `Revoke invitation to ${display}`;
