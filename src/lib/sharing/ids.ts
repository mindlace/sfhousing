export const PLAN_ID_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const PLAN_ID_RE = /^[1-9A-HJ-NP-Za-km-z]{8}$/;

export function newPlanId(
  rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))
): string {
  let id = '';
  while (id.length < 8) {
    for (const b of rand(16)) {
      if (b >= 232) continue; // 232 = 4 × 58: keeps byte % 58 uniform
      id += PLAN_ID_ALPHABET[b % 58];
      if (id.length === 8) break;
    }
  }
  return id;
}
