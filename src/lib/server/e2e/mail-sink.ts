import { isE2eEnv } from './env';

/** The mails whose link an e2e test must follow but no HTTP response carries. */
export type E2eMailKind = 'password-reset' | 'change-email-approve' | 'change-email-verify';

/** In-process record of the latest link per kind and address. e2e runs one worker, so a
 *  module-level map is shared by the request that sends and the request that reads. */
const sink = new Map<string, string>();

function key(kind: E2eMailKind, to: string): string {
  return `${kind}:${to.toLowerCase()}`;
}

/** Record the link a mail carries. A no-op unless `isE2eEnv(platform)`; latest wins. */
export function recordE2eMail(
  platform: App.Platform | undefined,
  kind: E2eMailKind,
  to: string,
  url: string
): void {
  if (!isE2eEnv(platform)) return;
  sink.set(key(kind, to), url);
}

/** The latest recorded link for this kind and address, or null. */
export function readE2eMail(kind: E2eMailKind, to: string): string | null {
  return sink.get(key(kind, to)) ?? null;
}

/** Forget every recorded link. */
export function clearE2eMail(): void {
  sink.clear();
}
