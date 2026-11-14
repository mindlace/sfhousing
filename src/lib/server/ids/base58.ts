import bs58 from 'bs58';
import {
  v7 as uuidv7,
  parse as uuidParse,
  stringify as uuidStringify,
  validate as uuidValidate,
  version as uuidVersion
} from 'uuid';

/**
 * Canonical entity id: a UUIDv7 re-encoded as Base58 (Bitcoin alphabet), ~22
 * chars, URL-safe and free of confusable glyphs. The same 128 bits as the UUID,
 * so global uniqueness is preserved; it is simply stored shorter.
 */
export function newId(): string {
  return bs58.encode(uuidParse(uuidv7()));
}

/** True iff `s` Base58-decodes to exactly 16 bytes forming a valid v7 UUID. */
export function isValidId(s: string): boolean {
  try {
    const bytes = bs58.decode(s);
    if (bytes.length !== 16) return false;
    const uuid = uuidStringify(bytes);
    return uuidValidate(uuid) && uuidVersion(uuid) === 7;
  } catch {
    return false;
  }
}

/** Recover the canonical hyphenated UUID from a Base58 id (logs / debugging). */
export function decodeId(s: string): string {
  return uuidStringify(bs58.decode(s));
}
