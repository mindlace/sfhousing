import { describe, it, expect } from 'vitest';
import { parseConfusables, sha256Hex } from './regen-confusables';

const FIXTURE = `# confusables.txt
# Version: 16.0.0
# Date: 2024-08-01
#
0030 ;	004F ;	MA	# ( 0 -> O ) DIGIT ZERO -> LATIN CAPITAL LETTER O
03BF ;	006F ;	MA	# ( omicron -> o ) GREEK SMALL LETTER OMICRON -> LATIN SMALL LETTER O
0131 ;	0069 ;	MA	# ( dotless i -> i )
1D41B ;	0062 ;	MA	# ( bold b -> b ) MATHEMATICAL BOLD SMALL B
0308 0301 ;	0344 ;	MA	# multi-source is ignored (source must be single cp)
00C5 ;	0041 030A ;	MA	# ( A-ring -> A-ring ) multi-codepoint TARGET
`;

describe('parseConfusables', () => {
  it('maps single-codepoint sources to full target strings', () => {
    const map = parseConfusables(FIXTURE);
    expect(map['0']).toBe('O');
    expect(map['ο']).toBe('o'); // greek omicron -> latin o
    expect(map['\u{1D41B}']).toBe('b'); // astral source handled
    // Source 00C5 (precomposed A-ring) -> target 0041 030A (decomposed A + combining ring).
    expect(map['Å']).toBe('Å'); // multi-codepoint target preserved
  });

  it('ignores multi-codepoint sources (handle is matched per single code point)', () => {
    const map = parseConfusables(FIXTURE);
    expect(map['̈́']).toBeUndefined();
  });
});

describe('sha256Hex', () => {
  it('matches a known SHA-256 vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});
