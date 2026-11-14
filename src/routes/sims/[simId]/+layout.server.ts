import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { requireSimRole } from '$lib/server/authz/require-sim-role';
import { listManagerPendingInvites } from '$lib/server/invites/control-plane';
import { getSimTitle, listMembers } from '$lib/server/sims/sim-index';

// The shared load for every /sims/[simId] route: auth (once), the title, the roster, the
// viewer's role, and for a manager the pending invitations. What reaches the browser is
// chosen field by field here: a member is { userId, handle, role } (never an email, name
// or image), and only a manager receives pending invitations ({ id, display,
// invitedByEmail }, where `display` is the address or @handle the manager typed).
export const load: LayoutServerLoad = async (event) => {
  const { simId } = event.params;
  const { role } = await requireSimRole(event, simId, 'viewer');
  const db = getDb(event.platform!);
  const [title, members, pending] = await Promise.all([
    getSimTitle({ db, simId }),
    listMembers({ db, simId }),
    role === 'manager' ? listManagerPendingInvites({ db, simId }) : Promise.resolve([])
  ]);
  if (title === null) throw error(404, 'Not found');
  return {
    simId,
    title,
    role,
    currentUserId: event.locals.user?.id ?? null,
    members: members.map(({ userId, handle, role: memberRole }) => ({
      userId,
      handle,
      role: memberRole
    })),
    pendingInvites: pending.map(({ id, display, invitedByEmail }) => ({
      id,
      display,
      invitedByEmail
    }))
  };
};
