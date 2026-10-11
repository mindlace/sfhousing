import { describe, expect, it } from 'vitest';
import {
  COPY,
  LIMIT_KB,
  cannotRead,
  formatPublished,
  kb,
  n3,
  n5,
  n6,
  ogDescription,
  remixConfirm,
  remixedToast,
  serverMessage,
  sizeLine,
  tooLarge
} from './copy';

describe('copy', () => {
  it('sizes', () => {
    expect(LIMIT_KB).toBe(256);
    expect(kb(1)).toBe(1);
    expect(kb(1025)).toBe(2);
    expect(sizeLine(41_000)).toBe('Size: 41 KB of 256 KB');
    expect(tooLarge(41 * 1024 + 1)).toBe(
      'This plan is too large to share (42 KB of the 256 KB limit). Try fewer or shorter strokes.'
    );
  });
  it('parameterised strings', () => {
    expect(cannotRead('x')).toBe(
      "The server couldn't read this plan (code: x). Please report this."
    );
    expect(n3('fixture-0', 'fixture-1')).toBe(
      "Your plan was made with an older map dataset (fixture-0). It's now shown on the current data (fixture-1), so some numbers may differ."
    );
    expect(n5('a', 'b')).toBe(
      'Made with map data a. Remixing moves it to the current data (b); numbers may change.'
    );
    expect(n6('a', 'b')).toBe(
      'Made with map data a, which is no longer available. Shown on the current data (b); numbers may differ from when it was published.'
    );
    expect(remixedToast('T')).toBe("Remixed from T. You're editing your own copy.");
    expect(remixConfirm(3)).toBe(
      'Replace your current plan (3 strokes) with a copy of this one? Your current plan will be lost unless you publish it first.'
    );
    expect(ogDescription(7)).toBe(
      'A plan for San Francisco housing with 7 brush strokes. Open it to see the buildings and net new units.'
    );
    expect(formatPublished('2026-10-11T23:30:00Z')).toBe('Oct 11, 2026');
  });
  it('static strings', () => {
    expect(COPY.disabledHint).toBe('Paint something first.');
    expect(COPY.n1).toContain("couldn't be read");
    expect(COPY.rateLimited).toBe(
      'Too many plans published from your network. Try again in a minute.'
    );
  });
  it('serverMessage', () => {
    expect(serverMessage('invalid_plan')).toBe(cannotRead('invalid_plan'));
    expect(serverMessage('too_large', 2048)).toBe(tooLarge(2048));
    expect(serverMessage('too_large')).toBe(
      'This plan is too large to share (over the 256 KB limit). Try fewer or shorter strokes.'
    );
    expect(serverMessage('too_many_ops')).toBe(COPY.tooManyOps);
    expect(serverMessage('unknown_dataset_version')).toBe(COPY.unknownDataset);
    expect(serverMessage('rate_limited')).toBe(COPY.rateLimited);
    expect(serverMessage('not_found')).toBe('Plan not found.');
    expect(serverMessage('server_error')).toBe(COPY.network);
  });
});
