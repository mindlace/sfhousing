import { error } from '@sveltejs/kit';
import { enabledAuthMethods, type AuthMethod } from './methods';

/** Throws the 404 for a request to something that belongs to a sign-in method that is off
 *  for it. Decided on the server for the request, never by what a page shows. */
export function requireMethod(
  event: Parameters<typeof enabledAuthMethods>[0],
  method: AuthMethod
): void {
  if (!enabledAuthMethods(event).has(method)) throw error(404);
}
