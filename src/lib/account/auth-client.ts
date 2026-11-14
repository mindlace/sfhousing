import { createAuthClient } from 'better-auth/svelte';
import { anonymousClient, magicLinkClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

export const authClient = createAuthClient({
  plugins: [anonymousClient(), magicLinkClient(), passkeyClient()]
});
