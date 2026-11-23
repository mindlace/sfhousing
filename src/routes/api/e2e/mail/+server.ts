// e2e-only read of the in-process mail sink: the link the latest mail of a kind to an
// address carried. The VITE_E2E check comes first and is replaced at build time, so in a
// normal build only the 404 branch ships.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isE2eEnv } from '$lib/server/e2e/env';
import { readE2eMail, type E2eMailKind } from '$lib/server/e2e/mail-sink';

const KINDS: ReadonlySet<string> = new Set<E2eMailKind>([
  'password-reset',
  'change-email-approve',
  'change-email-verify'
]);

export const GET: RequestHandler = ({ platform, url }) => {
  if (import.meta.env.VITE_E2E !== '1') return new Response(null, { status: 404 });
  if (!isE2eEnv(platform)) return new Response(null, { status: 404 });

  const kind = url.searchParams.get('kind') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!KINDS.has(kind) || !to) return new Response(null, { status: 404 });

  const link = readE2eMail(kind as E2eMailKind, to);
  if (!link) return new Response(null, { status: 404 });
  return json({ url: link });
};
