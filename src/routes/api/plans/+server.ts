import { handlePublish } from '$lib/server/sharing/publish';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => handlePublish(event);
