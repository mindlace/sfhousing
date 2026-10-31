import { handleGetPlan } from '$lib/server/sharing/get-plan';
import { PLAN_CODEC } from '$lib/sharing/doc-codec';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => handleGetPlan(event, PLAN_CODEC);
