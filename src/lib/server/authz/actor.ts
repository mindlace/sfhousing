/** Who is acting on a request. */
export const ACTOR_KINDS = ['human', 'ai', 'automation', 'public'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export type Actor = { actorId: string; actorKind: ActorKind };

/** The actor id of a request that resolved no principal. */
export const PUBLIC_ACTOR_ID = 'group:public';
