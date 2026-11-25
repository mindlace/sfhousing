import { describe, expect, it } from 'vitest';
import { onPrefs, readCollectForMe, readMuted, writeCollectForMe, writeMuted } from './prefs';

describe('prefs', () => {
  it('readCollectForMe throws until run-play writes it', () => {
    expect(() => readCollectForMe(null)).toThrow('not implemented');
  });

  it('writeCollectForMe throws until run-play writes it', () => {
    expect(() => writeCollectForMe(null, true)).toThrow('not implemented');
  });

  it('readMuted throws until run-play writes it', () => {
    expect(() => readMuted(null)).toThrow('not implemented');
  });

  it('writeMuted throws until run-play writes it', () => {
    expect(() => writeMuted(null, false)).toThrow('not implemented');
  });

  it('onPrefs throws until run-play writes it', () => {
    expect(() => onPrefs(() => {})).toThrow('not implemented');
  });
});
