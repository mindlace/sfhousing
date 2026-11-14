/**
 * Client-side overlay for the signed-in user's own profile fields (handle, display name).
 *
 * `data.user` rides the root layout's server load, which reads `locals` and is NOT re-run by
 * client navigation — so a profile save used to observe itself with `invalidateAll()`, a
 * whole-page data reload for two strings. Instead the pane records the server's OWN response
 * here and every surface that renders the user reads `currentUser.overlay(data.user)`.
 *
 * Only ever written from a 2xx response, so the overlay carries the stored (normalized)
 * values, never the raw input.
 *
 * **Keyed to the identity it was recorded against.** This is a module singleton living for
 * the life of the DOCUMENT, and sign-out is a client navigation (`goto('/', { invalidateAll:
 * true })`) — the document, and therefore this object, survives it. The landing front door
 * then mints a fresh pseudonymous account, so an unkeyed overlay would paint the previous
 * account's handle onto the next one. Recording the identity id at `apply()` time makes the
 * overlay inert for anyone else.
 */
export class CurrentUser {
  /** The identity every field below was recorded against; null until the first write. */
  #userId = $state<string | null>(null);
  handle = $state<string | null>(null);
  name = $state<string | null>(null);

  apply(userId: string, patch: { handle?: string; name?: string }): void {
    if (this.#userId !== userId) {
      this.#userId = userId;
      this.handle = null;
      this.name = null;
    }
    if (patch.handle !== undefined) this.handle = patch.handle;
    if (patch.name !== undefined) this.name = patch.name;
  }

  /** The recorded handle, but only for the identity it belongs to; null otherwise. */
  handleFor(userId: string | null | undefined): string | null {
    return userId != null && userId === this.#userId ? this.handle : null;
  }

  overlay<T extends { id: string; handle: string; name?: string | null }>(
    user: T | null
  ): T | null {
    if (!user) return null;
    if (user.id !== this.#userId) return user;
    if (this.handle === null && this.name === null) return user;
    return {
      ...user,
      handle: this.handle ?? user.handle,
      name: this.name ?? user.name
    };
  }
}

export const currentUser = new CurrentUser();
