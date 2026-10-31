import { handlePublish } from '$lib/server/sharing/publish';
import { PLAN_CODEC } from '$lib/sharing/doc-codec';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => handlePublish(event, PLAN_CODEC);
