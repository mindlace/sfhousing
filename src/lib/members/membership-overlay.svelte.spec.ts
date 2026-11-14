import { describe, it, expect } from 'vitest';
import { MembershipOverlay, type OverlayInvite } from './membership-overlay.svelte';

const Q = 's1';
const baseMembers = [
  { userId: 'u1', handle: 'ada', role: 'manager' },
  { userId: 'u2', handle: 'mara', role: 'editor' }
];
const baseInvites: OverlayInvite[] = [
  { id: 'inv1', display: 'ada@test.com', invitedByEmail: true }
];
/** The `load` payloads a write is recorded against. */
const base = () => ({ members: baseMembers, invites: baseInvites });

describe('MembershipOverlay', () => {
  it('passes base data through untouched before any write', () => {
    expect.hasAssertions();
    const ov = new MembershipOverlay();
    expect(ov.members(Q, baseMembers)).toEqual(baseMembers);
    expect(ov.invites(Q, baseInvites)).toEqual(baseInvites);
  });

  it('removeMember filters the member out of the base list', () => {
    expect.hasAssertions();
    const ov = new MembershipOverlay();
    ov.removeMember(Q, 'u2', base());
    expect(ov.members(Q, baseMembers).map((m) => m.userId)).toEqual(['u1']);
  });

  it('addInvite appends the new invite', () => {
    expect.hasAssertions();
    const ov = new MembershipOverlay();
    const added: OverlayInvite = { id: 'inv2', display: 'zoe@test.com', invitedByEmail: true };
    ov.addInvite(Q, added, base());
    expect(ov.invites(Q, baseInvites)).toEqual([...baseInvites, added]);
  });

  it('addInvite is idempotent against a base that already carries the row', () => {
    expect.hasAssertions();
    const ov = new MembershipOverlay();
    const added: OverlayInvite = { id: 'inv2', display: 'zoe@test.com', invitedByEmail: true };
    const seeded = [...baseInvites, added];
    ov.addInvite(Q, added, { members: baseMembers, invites: seeded });
    // A later render with the SAME base that already carries the new row must not
    // double-apply it.
    expect(ov.invites(Q, seeded)).toEqual(seeded);
  });

  it('removeInvite filters the invite out, idempotently', () => {
    expect.hasAssertions();
    const ov = new MembershipOverlay();
    ov.removeInvite(Q, 'inv1', base());
    expect(ov.invites(Q, baseInvites)).toEqual([]);
    // Re-applied against the same base — still empty, no throw.
    expect(ov.invites(Q, baseInvites)).toEqual([]);
  });

  it('ignores writes recorded against a different sim', () => {
    expect.hasAssertions();
    const ov = new MembershipOverlay();
    ov.removeMember('other-sim', 'u2', base());
    expect(ov.members(Q, baseMembers)).toEqual(baseMembers);
  });

  it('a write for a new sim discards the previous sim overlay', () => {
    expect.hasAssertions();
    const ov = new MembershipOverlay();
    ov.removeMember(Q, 'u2', base());
    ov.removeMember('q2', 'u9', base());
    expect(ov.members(Q, baseMembers)).toEqual(baseMembers);
    expect(ov.members('q2', baseMembers).map((m) => m.userId)).toEqual(['u1', 'u2']);
  });

  it('retires an added invite once the server re-speaks without it (invitee accepted)', () => {
    expect.hasAssertions();
    const ov = new MembershipOverlay();
    const added: OverlayInvite = { id: 'inv2', display: 'zoe@test.com', invitedByEmail: true };
    ov.addInvite(Q, added, base());
    expect(ov.invites(Q, baseInvites)).toEqual([...baseInvites, added]);
    // The invitee accepted; a fresh layout load re-seeds pendingInvites WITHOUT the invite.
    // A fresh array IS the server re-speaking — the overlay must not re-add the row.
    const fresh: OverlayInvite[] = [{ id: 'inv1', display: 'ada@test.com', invitedByEmail: true }];
    expect(ov.invites(Q, fresh)).toEqual(fresh);
  });

  it('retires a removed member once the server re-speaks with them back (re-invited)', () => {
    expect.hasAssertions();
    const ov = new MembershipOverlay();
    ov.removeMember(Q, 'u2', base());
    expect(ov.members(Q, baseMembers).map((m) => m.userId)).toEqual(['u1']);
    // u2 was re-invited and accepted; a fresh load carries them again. The stale removal
    // must not filter them back out.
    const fresh = [
      { userId: 'u1', handle: 'ada', role: 'manager' },
      { userId: 'u2', handle: 'mara', role: 'editor' }
    ];
    expect(ov.members(Q, fresh).map((m) => m.userId)).toEqual(['u1', 'u2']);
  });

  it('sorts the merged invite list by display, as the server list load does', () => {
    expect.hasAssertions();
    const ov = new MembershipOverlay();
    const added: OverlayInvite = { id: 'inv2', display: 'abe@test.com', invitedByEmail: true };
    ov.addInvite(Q, added, base());
    expect(ov.invites(Q, baseInvites).map((i) => i.display)).toEqual([
      'abe@test.com',
      'ada@test.com'
    ]);
  });
});
