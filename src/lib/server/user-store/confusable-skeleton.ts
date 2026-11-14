// The map ships as a JSON *string* (parsed at runtime), never an object literal. Several
// confusable-prototype keys are exotic code points (e.g. U+A7DA "Ꟛ") that a minify pass
// emits as bare, invalid identifiers — breaking the build; a parsed string keeps every key
// quoted. It lives in a generated `.ts` module (not `confusables.json?raw`) so BOTH bundlers
// agree: Vite's `?raw` query is unknown to the worker esbuild pass, which would otherwise
// re-resolve the JSON as an object and crash on `JSON.parse([object Object])` at boot.
import confusablesRaw from './confusables-data';

const MAP = JSON.parse(confusablesRaw) as Record<string, string>;

/**
 * UTS #39 "skeleton" (the homoglyphic hash): map each code point to its Unicode
 * confusable prototype, then case-fold. Two handles are confusable iff their
 * skeletons are equal. Internal comparison key only — NEVER displayed.
 */
export function skeleton(handle: string): string {
  let out = '';
  for (const cp of handle) out += MAP[cp] ?? cp; // [...handle] code-point iteration
  return out.toLowerCase(); // collapse map's uppercase prototypes (0→O→o, 1→l)
}
