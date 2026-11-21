// A kind's "+" by its accessible name, whichever it has: "Add {Kind} policy", or while the closed,
// empty kind's lane shows its words, those words (KindRow, `EMPTY_LANE`). Test values.
export const PLUS_NAME = {
  Zoning: /^Add (Zoning policy|a zoning change)$/,
  Permitting: /^Add (Permitting policy|a permitting change)$/,
  'Public money': /^Add (Public money policy|public money)$/
} as const;
