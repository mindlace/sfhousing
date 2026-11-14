import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ACCOUNT_COPY } from '$lib/account/account-copy';
import { getDb } from '$lib/server/db';
import { enforceRate } from '$lib/server/security/rate-limit';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';
import { updateProfile } from '$lib/server/user-store/profile';

export const PATCH: RequestHandler = async (event) => {
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  const { locals, request, platform, getClientAddress } = event;
  if (!locals.user) return json({ error: ACCOUNT_COPY.signinRequired }, { status: 401 });
  const ip = getClientAddress();
  if (
    !(await enforceRate(
      platform!.env.ACCOUNT_EDIT_RL,
      `account_edit:${locals.user.id}:${ip}`,
      platform!.env
    ))
  ) {
    return json({ error: ACCOUNT_COPY.tooManyChanges }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as {
    handle?: string;
    name?: string;
  } | null;
  const handleRaw = String(body?.handle ?? '').trim();
  const name = String(body?.name ?? '');
  const handle = handleRaw === '' ? undefined : handleRaw;
  const res = await updateProfile(getDb(platform!), locals.user.id, { handle, name }, new Date());
  if (!res.ok) {
    return json({ error: res.reason, handle, name }, { status: 400 });
  }
  return json({
    success: true,
    handleChanged: res.handleChanged,
    oldHandleFreesAt: res.oldHandleFreesAt ? res.oldHandleFreesAt.toISOString() : null,
    handle: res.handle,
    name: res.name
  });
};
