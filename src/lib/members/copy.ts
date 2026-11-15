/** The most sims one person can manage. */
export const MAX_SIMS_PER_MANAGER = 1000;
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
  createFailed: "Couldn't create the sim. Try again.",
  quota: `You can manage up to ${MAX_SIMS_PER_MANAGER.toLocaleString('en-US')} sims.`,
  invalidId: 'That sim id is not valid.',
  notYours: "That sim isn't yours.",
  // Renaming on the member page.
  renameSummary: 'Rename',
  renameLabel: 'Name',
  renameSave: 'Save',
  renameBusy: 'Too many changes at once. Try again shortly.',
  renameFull: 'This sim is full.',
  renameUnavailable: "Renaming isn't available here.",
  renameFailed: "Couldn't rename the sim. Try again."
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
  // Invitations addressed to the signed-in user.
  invitationsDeclinedToast: 'Invitation declined',
  invitationsAcceptFailedToast: "Couldn't accept that invitation. Try again.",
  invitationsActionFailedToast: "That didn't go through. Try again.",
  invitationsHeading: 'Invitations',
  invitationsAccept: 'Accept',
  invitationsDecline: 'Decline',
  inviteNotNow: 'Not now',
  inviteView: 'View',
  inviteBannerLabel: 'Invitations',
  // The member list and invite form.
  membersSummary: 'Members',
  membersInvite: 'Invite',
  membersPending: 'Pending',
  membersResent: 'Invitation sent',
  membersResend: 'Resend',
  membersRevoke: 'Revoke',
  membersRemove: 'Remove',
  membersConfirmCancel: 'Cancel',
  membersInvitePlaceholder: 'Email or @handle',
  membersInviteLabel: 'Invite by email or handle',
  // A manager with no confirmed email can invite by handle only.
  membersInviteHandlePlaceholder: '@handle',
  membersInviteHandleLabel: 'Invite by handle',
  // The leave flow.
  leaveButton: 'Leave sim',
  leaveSoleMemberWarning:
    "You're the only member. Once you leave, nobody can edit this sim and its invitations end. Its links still open.",
  leaveLastButton: 'Leave sim',
  leaveCancel: 'Cancel',
  leaveSuccessorLabel: 'Who takes over?',
  leaveSuccessorAuto: 'Let the app choose',
  leaveHandoffButton: 'Hand off & leave',
  leaveConfirmTitleLabel: 'Type the sim title to confirm',
  leaveSimplePrompt: 'Leave this sim?',
  leaveSimpleButton: 'Leave',
  // Server answers.
  notSignedIn: 'Sign in first.',
  inviteNetworkRateLimited: 'Too many invites from your network. Please wait a moment.',
  // Stands in for a sim's title when its index row is gone.
  simTitleFallback: 'a sim'
} as const;

/**
 * What the members routes and actions answer on failure is one of these codes, never server
 * or exception text; the page shows the line for it. Anything else shows `failed`.
 */
export const MEMBER_ERROR_COPY = {
  target_required: 'Enter an email or @handle.',
  already_member: 'Already a member.',
  already_invited: 'Already invited.',
  too_many_pending: 'Too many pending invitations. Revoke one first.',
  no_such_handle: 'No one has that handle.',
  email_needs_confirmed: 'Add a confirmed email on Account to invite by email.',
  invite_invalid: 'This invitation is no longer valid.',
  not_addressed: 'This invitation is for someone else.',
  resend_too_soon: 'Sent recently. Try again later.',
  manager_protected: "Managers can't be removed.",
  not_member: 'Not a member of this sim.',
  title_mismatch: "That title doesn't match.",
  sim_not_found: 'Sim not found.',
  create_account_failed: "Couldn't create your account. Try signing in instead.",
  rate_limited: 'Too many requests. Wait a moment.',
  session_start: "Couldn't start your session. Try again.",
  failed: "That didn't go through. Try again."
} as const;

export type MemberErrorCode = keyof typeof MEMBER_ERROR_COPY;

export const isMemberErrorCode = (code: unknown): code is MemberErrorCode =>
  typeof code === 'string' && Object.hasOwn(MEMBER_ERROR_COPY, code);

/** The line for a code from a members route or action; one generic line for anything else. */
export const memberErrorText = (code: unknown): string =>
  isMemberErrorCode(code) ? MEMBER_ERROR_COPY[code] : MEMBER_ERROR_COPY.failed;

export const membersRemoveConfirm = (handle: string): string => `Remove @${handle}?`;
export const membersRevokeConfirm = (display: string): string => `Revoke ${display}?`;

export const inviteHeading = (handle: string, simTitle: string): string =>
  `@${handle} invited you to "${simTitle}"`;
export const invitationsRow = (handle: string, simTitle: string): string =>
  `@${handle} invited you to ${simTitle}`;
export const invitationsAcceptNamed = (simTitle: string): string =>
  `Accept invitation to ${simTitle}`;
export const invitationsDeclineNamed = (simTitle: string): string =>
  `Decline invitation to ${simTitle}`;
export const inviteMultiple = (count: number): string => `You have ${count} invitations`;
export const membersSummaryCount = (count: number): string =>
  `${MEMBERS_COPY.membersSummary} (${count})`;
export const membersRemoveNamed = (handle: string): string => `Remove ${handle} from the sim`;
export const membersResendNamed = (display: string): string => `Resend invitation to ${display}`;
export const membersRevokeNamed = (display: string): string => `Revoke invitation to ${display}`;
