import { describe, it, expect } from 'vitest';
import { toNfc, normTextToDriver } from './columns';

describe('toNfc', () => {
  it('composes NFD input to NFC', () => {
    // Construct NFD (decomposed: e + combining acute) explicitly
    const nfd = 'café'.normalize('NFD');
    // Construct NFC (precomposed) explicitly
    const nfc = 'café'.normalize('NFC');
    expect(toNfc(nfd)).toBe(nfc);
    expect(toNfc(nfd)).not.toBe(nfd);
  });

  it('is idempotent and a no-op on ASCII', () => {
    expect(toNfc(toNfc('á'))).toBe(toNfc('á'));
    expect(toNfc('plain ascii')).toBe('plain ascii');
  });
});

describe('normTextToDriver', () => {
  it.each([null, undefined])('passes %s through without throwing', (v) => {
    expect(normTextToDriver(v as unknown as string)).toBe(v);
  });

  it('normalizes non-null strings to NFC', () => {
    // Construct NFD (decomposed form)
    const nfd = 'café'.normalize('NFD');
    // Construct NFC (precomposed form)
    const nfc = 'café'.normalize('NFC');
    expect(normTextToDriver(nfd)).toBe(nfc);
    expect(normTextToDriver(nfd)).not.toBe(nfd);
  });
});
