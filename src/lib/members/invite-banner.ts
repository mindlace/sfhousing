import { MEMBERS_COPY, inviteHeading, inviteMultiple } from './copy';

export interface PendingInvite {
  id: string;
  simId: string;
  simTitle: string;
  inviterHandle: string;
}

export type BannerActionId = 'accept' | 'decline' | 'dismiss' | 'view';

export interface BannerModel {
  message: string;
  actions: { id: BannerActionId; label: string }[];
  /** The invite Accept and Decline act on; null for the several-invites banner. */
  invite: PendingInvite | null;
}

/** The sims list already shows invitations, so the banner is not shown there. */
const SUPPRESSED_PATH = '/sims';

/** What the invitation banner shows for these invitations on this path, or null for none. */
export function inviteBannerModel(
  invites: PendingInvite[],
  currentPath: string
): BannerModel | null {
  if (invites.length === 0 || currentPath === SUPPRESSED_PATH) return null;
  if (invites.length === 1) {
    const invite = invites[0];
    return {
      message: inviteHeading(invite.inviterHandle, invite.simTitle),
      actions: [
        { id: 'accept', label: MEMBERS_COPY.invitationsAccept },
        { id: 'decline', label: MEMBERS_COPY.invitationsDecline },
        { id: 'dismiss', label: MEMBERS_COPY.inviteNotNow }
      ],
      invite
    };
  }
  return {
    message: inviteMultiple(invites.length),
    actions: [
      { id: 'view', label: MEMBERS_COPY.inviteView },
      { id: 'dismiss', label: MEMBERS_COPY.inviteNotNow }
    ],
    invite: null
  };
}
