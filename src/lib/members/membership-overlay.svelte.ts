/**
 * Local-apply overlay for sim membership writes (invite / remove / revoke).
 *
 * Members and pending invites render from `page.data` (the [simId] layout load). A
 * mutation used to observe itself with `invalidateAll()` — a whole-page data reload for one
 * row. Instead the caller records the write here and the surface renders `base + overlay`.
 *
 * Three properties make this safe without any reset plumbing:
 *
 * - **Sim-keyed.** The overlay remembers which sim it was recorded against and is
 *   ignored for any other sim, so navigating between sims never leaks a write.
 * - **Idempotent.** Removals filter and additions dedupe by id, so re-seeding `page.data`
 *   with the very same facts cannot double-apply.
 * - **Retired by the server.** The overlay also remembers the base arrays it was recorded
 *   against. A fresh array out of `load` IS the signal that the server has re-spoken, so
 *   the overlay simply stops applying: it can never outlive the fact it was recorded
 *   against. Without this, an invite the invitee has since accepted would be re-added to
 *   the pending list forever, and a removed-then-re-invited member would stay filtered out
 *   of the roster forever.
 *
 * Nothing here is optimistic: callers record only AFTER the server responds ok.
 */
export interface OverlayInvite {
  id: string;
  display: string;
  invitedByEmail: boolean;
}

export class MembershipOverlay {
  /** The sim every recorded write below belongs to; null until the first write. */
  #simId = $state<string | null>(null);
  // The base arrays in play when the writes below were recorded — the retirement key.
  // `$state.raw`, deliberately: a deep `$state` proxies what it stores, and the whole point
  // here is to compare the stored value by IDENTITY against the array `load` hands back.
  #baseMembers = $state.raw<readonly unknown[] | null>(null);
  #baseInvites = $state.raw<readonly OverlayInvite[] | null>(null);
  #removedMemberIds = $state<string[]>([]);
  #addedInvites = $state<OverlayInvite[]>([]);
  #removedInviteIds = $state<string[]>([]);

  /**
   * Start a fresh overlay whenever the write lands against a sim — or a `load` payload —
   * we aren't already holding writes for.
   */
  #focus(simId: string, members: readonly unknown[], invites: readonly OverlayInvite[]): void {
    if (this.#simId === simId && this.#baseMembers === members && this.#baseInvites === invites) {
      return;
    }
    this.#simId = simId;
    this.#baseMembers = members;
    this.#baseInvites = invites;
    this.#removedMemberIds = [];
    this.#addedInvites = [];
    this.#removedInviteIds = [];
  }

  addInvite(
    simId: string,
    invite: OverlayInvite,
    base: { members: readonly unknown[]; invites: readonly OverlayInvite[] }
  ): void {
    this.#focus(simId, base.members, base.invites);
    this.#addedInvites = [...this.#addedInvites.filter((i) => i.id !== invite.id), invite];
  }

  removeInvite(
    simId: string,
    inviteId: string,
    base: { members: readonly unknown[]; invites: readonly OverlayInvite[] }
  ): void {
    this.#focus(simId, base.members, base.invites);
    this.#addedInvites = this.#addedInvites.filter((i) => i.id !== inviteId);
    this.#removedInviteIds = [...this.#removedInviteIds, inviteId];
  }

  removeMember(
    simId: string,
    userId: string,
    base: { members: readonly unknown[]; invites: readonly OverlayInvite[] }
  ): void {
    this.#focus(simId, base.members, base.invites);
    this.#removedMemberIds = [...this.#removedMemberIds, userId];
  }

  members<T extends { userId: string }>(simId: string | undefined, base: T[]): T[] {
    if (!simId || this.#simId !== simId || this.#baseMembers !== base) return base;
    return base.filter((m) => !this.#removedMemberIds.includes(m.userId));
  }

  invites(simId: string | undefined, base: OverlayInvite[]): OverlayInvite[] {
    if (!simId || this.#simId !== simId || this.#baseInvites !== base) return base;
    const kept = base.filter((i) => !this.#removedInviteIds.includes(i.id));
    const keptIds = kept.map((i) => i.id);
    const merged = [...kept, ...this.#addedInvites.filter((i) => !keptIds.includes(i.id))];
    // The server's list load sorts by `display` (see `listManagerPendingInvites`); sort the
    // merged list the same way so a locally-added row doesn't jump position on the next
    // real load.
    return merged.sort((a, b) => a.display.localeCompare(b.display));
  }
}
