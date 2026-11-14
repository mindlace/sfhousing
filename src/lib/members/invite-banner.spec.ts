import { describe, expect, it } from 'vitest';
import { MEMBERS_COPY, inviteHeading, inviteMultiple } from './copy';
import { inviteBannerModel, type PendingInvite } from './invite-banner';

const single: PendingInvite[] = [
  { id: 'i1', simId: 's1', simTitle: 'Roadtrip', inviterHandle: 'ada' }
];
const many: PendingInvite[] = [
  { id: 'i1', simId: 's1', simTitle: 'Roadtrip', inviterHandle: 'ada' },
  { id: 'i2', simId: 's2', simTitle: 'Garden', inviterHandle: 'bob' },
  { id: 'i3', simId: 's3', simTitle: 'Move', inviterHandle: 'cy' }
];

describe('inviteBannerModel', () => {
  it('is null with no invites', () => {
    expect(inviteBannerModel([], '/sims/s1')).toBeNull();
  });

  it('is null on /sims even with invites', () => {
    expect(inviteBannerModel(single, '/sims')).toBeNull();
    expect(inviteBannerModel(many, '/sims')).toBeNull();
  });

  it('shows on a sim page', () => {
    expect(inviteBannerModel(single, '/sims/s1')).not.toBeNull();
  });

  it('gives one invite the invite heading and Accept, Decline, Not now', () => {
    const model = inviteBannerModel(single, '/sims/s1')!;
    expect(model.message).toBe(inviteHeading('ada', 'Roadtrip'));
    expect(model.invite).toEqual(single[0]);
    expect(model.actions).toEqual([
      { id: 'accept', label: MEMBERS_COPY.invitationsAccept },
      { id: 'decline', label: MEMBERS_COPY.invitationsDecline },
      { id: 'dismiss', label: MEMBERS_COPY.inviteNotNow }
    ]);
  });

  it('gives several invites the count and View, Not now', () => {
    const model = inviteBannerModel(many, '/sims/s1')!;
    expect(model.message).toBe(inviteMultiple(3));
    expect(model.message).toContain('3');
    expect(model.invite).toBeNull();
    expect(model.actions).toEqual([
      { id: 'view', label: MEMBERS_COPY.inviteView },
      { id: 'dismiss', label: MEMBERS_COPY.inviteNotNow }
    ]);
  });
});
