// /fzp is no longer a page (plan 3, Call 14): a 307 to /sim with every query parameter kept except
// the retired `start`. /sim opens on the Family Zoning Plan comparison itself. 307 is temporary, so
// the route can change again without browsers caching a permanent redirect.
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
  const params = new URLSearchParams(url.searchParams);
  params.delete('start');
  const query = params.toString();
  redirect(307, query ? `/sim?${query}` : '/sim');
};
