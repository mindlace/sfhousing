import { describe, it, expect } from 'vitest';
import { normalizeHandle, validateHandle } from './handle-normalize';

describe('normalizeHandle', () => {
  it('trims, NFC-normalizes, and case-folds', () => {
    // "Café" with a combining accent → NFC precomposed, lowercased
    expect(normalizeHandle('  Café  ')).toBe('café');
  });
});

describe('validateHandle', () => {
  it('accepts a plain Latin handle and returns its skeleton', () => {
    const r = validateHandle('Quiet-Otter');
    expect(r).toEqual({ ok: true, handle: 'quiet-otter', skeleton: 'quiet-otter' });
  });

  it('accepts a single-script Greek handle', () => {
    const r = validateHandle('αλέξη'); // αλέξη
    expect(r.ok).toBe(true);
  });

  it('rejects mixed-script (Latin + Greek) — the bobby/bοbby case', () => {
    const r = validateHandle('bοbby'); // bοbby (Greek omicron U+03BF)
    expect(r).toMatchObject({ ok: false, reason: 'mixed-script' });
  });

  it('rejects too-short and too-long handles', () => {
    expect(validateHandle('ab')).toMatchObject({ ok: false, reason: 'length' });
    expect(validateHandle('a'.repeat(31))).toMatchObject({ ok: false, reason: 'length' });
  });

  it('rejects control/format characters (zero-width joiner, RTL override)', () => {
    expect(validateHandle('ab‍cd')).toMatchObject({ ok: false, reason: 'charset' });
    expect(validateHandle('ab‮cd')).toMatchObject({ ok: false, reason: 'charset' });
  });

  it('rejects whitespace, punctuation, symbols, and emoji', () => {
    expect(validateHandle('a b c')).toMatchObject({ ok: false, reason: 'charset' });
    expect(validateHandle('a.b')).toMatchObject({ ok: false, reason: 'charset' });
    expect(validateHandle('a\u{1F600}b')).toMatchObject({ ok: false, reason: 'charset' });
  });

  it('rejects leading/trailing/double hyphens and leading combining marks', () => {
    expect(validateHandle('-abc')).toMatchObject({ ok: false, reason: 'hyphen' });
    expect(validateHandle('abc-')).toMatchObject({ ok: false, reason: 'hyphen' });
    expect(validateHandle('ab--c')).toMatchObject({ ok: false, reason: 'hyphen' });
  });

  it('rejects unsupported scripts', () => {
    // U+10A0 Georgian capital — not in the curated allowlist
    expect(validateHandle('ႠႡႢ')).toMatchObject({
      ok: false,
      reason: 'unsupported-script'
    });
  });

  it('rejects reserved words AND their confusable spoofs', () => {
    expect(validateHandle('admin')).toMatchObject({ ok: false, reason: 'reserved' });
    // single-script reserved spoof: r00t (Latin + Common digits) → skeleton 'root' (reserved)
    expect(validateHandle('r00t')).toMatchObject({ ok: false, reason: 'reserved' });
  });

  it.each(['sims', 'sim', 'lesscars', 'fzp', 'attribution', 'data'])('reserves %s', (word) => {
    expect(validateHandle(word)).toMatchObject({ ok: false, reason: 'reserved' });
  });

  it.each(['s', 'p'])('rejects the one-letter route %s', (word) => {
    expect(validateHandle(word).ok).toBe(false);
  });

  it('no longer reserves quests', () => {
    expect(validateHandle('quests')).toMatchObject({ ok: true, handle: 'quests' });
  });
});
