/**
 * App-level operator abilities (dot-namespaced), scoped to `app:*` in the capability
 * ledger. New admin needs are added by declaring a constant here. Dominance lives in the
 * shared authz core (`abilityDominates`), not here.
 */
export const OPERATOR_ABILITIES = ['cap.grant', 'cap.revoke'] as const;

export type OperatorAbility = (typeof OPERATOR_ABILITIES)[number];
