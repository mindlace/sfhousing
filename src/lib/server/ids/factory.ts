/**
 * Entity id helpers. Re-exports the canonical Base58 id (RFC 9562 UUIDv7
 * re-encoded). `newId` mints Better-Auth row ids; `isValidId` is the
 * validation counterpart.
 */
export { newId, isValidId } from './base58';
