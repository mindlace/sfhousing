import { handleGetPlan } from '$lib/server/sharing/get-plan';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => handleGetPlan(event);
