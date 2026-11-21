import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** The old data page: a permanent redirect into About's Data and licences (docs/dev/about.md). */
export const load: PageServerLoad = () => {
  redirect(308, '/about#about-data');
};
