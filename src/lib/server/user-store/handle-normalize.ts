import { skeleton } from './confusable-skeleton';

/** Canonical form: stored, and compared against on every lookup. */
export function normalizeHandle(raw: string): string {
  return raw.trim().normalize('NFC').toLowerCase(); // toLowerCase, NOT toLocaleLowerCase
}

/** Reserved labels (this module owns the list; profile.ts reaches it through validateHandle). */
export const RESERVED = new Set([
  'api',
  'mcp',
  'account',
  'signin',
  'signout',
  'invite',
  'sims',
  'sim',
  's',
  'p',
  'lesscars',
  'fzp',
  'attribution',
  'data',
  'oauth',
  'admin',
  'root',
  'support',
  'settings',
  'app',
  'www',
  'help',
  'about',
  'terms',
  'privacy'
]);
const RESERVED_SKELETONS = new Set([...RESERVED].map(skeleton));

const MIN_LEN = 3;
const MAX_LEN = 30;

// Allowed: letters, combining marks, decimal digits, ASCII hyphen.
const ALLOWED = /^[\p{L}\p{M}\p{Nd}-]+$/u;
const LEADING_MARK = /^\p{M}/u;

// Curated supported scripts (extensible). Each tests a single code point.
const SCRIPTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Latin', /\p{scx=Latin}/u],
  ['Greek', /\p{scx=Greek}/u],
  ['Cyrillic', /\p{scx=Cyrillic}/u],
  ['Han', /\p{scx=Han}/u],
  ['Hiragana', /\p{scx=Hiragana}/u],
  ['Katakana', /\p{scx=Katakana}/u],
  ['Hangul', /\p{scx=Hangul}/u],
  ['Arabic', /\p{scx=Arabic}/u],
  ['Hebrew', /\p{scx=Hebrew}/u],
  ['Devanagari', /\p{scx=Devanagari}/u],
  ['Thai', /\p{scx=Thai}/u]
];
// Script-neutral: digits, hyphen, generic combining marks — allowed alongside any one script.
const NEUTRAL = /[\p{scx=Common}\p{scx=Inherited}]/u;

export type HandleValidation =
  | { ok: true; handle: string; skeleton: string }
  | {
      ok: false;
      reason: 'length' | 'charset' | 'hyphen' | 'mixed-script' | 'unsupported-script' | 'reserved';
    };

export function validateHandle(raw: string): HandleValidation {
  const handle = normalizeHandle(raw);
  const cps = [...handle];

  if (cps.length < MIN_LEN || cps.length > MAX_LEN) return { ok: false, reason: 'length' };
  if (!ALLOWED.test(handle)) return { ok: false, reason: 'charset' };
  if (
    handle.startsWith('-') ||
    handle.endsWith('-') ||
    handle.includes('--') ||
    LEADING_MARK.test(handle)
  )
    return { ok: false, reason: 'hyphen' };

  // Single script (neutrals match any).
  let script: string | null = null;
  for (const cp of cps) {
    if (NEUTRAL.test(cp)) continue;
    const matched = SCRIPTS.find(([, re]) => re.test(cp));
    if (!matched) return { ok: false, reason: 'unsupported-script' };
    if (script === null) script = matched[0];
    else if (script !== matched[0]) return { ok: false, reason: 'mixed-script' };
  }

  const sk = skeleton(handle);
  if (RESERVED_SKELETONS.has(sk)) return { ok: false, reason: 'reserved' };

  return { ok: true, handle, skeleton: sk };
}
