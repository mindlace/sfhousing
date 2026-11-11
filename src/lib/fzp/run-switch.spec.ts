import { describe, expect, it } from 'vitest';
import { RunSwitcher } from './run-switch';

function make() {
  const sent: (number | null)[] = [];
  let rev = 0;
  const s = new RunSwitcher((seed) => {
    sent.push(seed);
    return ++rev;
  });
  return { s, sent };
}

describe('RunSwitcher', () => {
  it('sends at once when idle', () => {
    const { s, sent } = make();
    s.select(3);
    expect(sent).toEqual([3]);
    expect(s.settled).toBe(false);
  });
  it('keeps only the latest waiting seed and sends it on the answer', () => {
    const { s, sent } = make();
    s.select(3);
    s.select(4);
    s.select(5);
    expect(sent).toEqual([3]);
    expect(s.answer(1)).toEqual({ seed: 3 });
    expect(sent).toEqual([3, 5]);
  });
  it('does not resend the seed just answered', () => {
    const { s, sent } = make();
    s.select(3);
    s.select(3);
    s.answer(1);
    expect(sent).toEqual([3]);
    expect(s.settled).toBe(true);
  });
  it('an answer at a later rev ends the in-flight request', () => {
    const { s } = make();
    s.select(3);
    expect(s.answer(1 + 7)).toEqual({ seed: 3 });
  });
  it('an older rev answers nothing', () => {
    const { s, sent } = make();
    s.select(3);
    s.select(4);
    expect(s.answer(0)).toBeUndefined();
    expect(sent).toEqual([3]);
    expect(s.settled).toBe(false);
  });
  it('fail ends the in-flight request and sends the waiting one', () => {
    const { s, sent } = make();
    s.select(3);
    s.select(4);
    expect(s.fail(1)).toEqual({ seed: 3 });
    expect(sent).toEqual([3, 4]);
  });
  it('reset drops both; a late answer returns undefined and sends nothing', () => {
    const { s, sent } = make();
    s.select(3);
    s.select(4);
    s.reset();
    expect(s.answer(1)).toBeUndefined();
    expect(sent).toEqual([3]);
    expect(s.settled).toBe(true);
  });
  it('settled once the last answer is in', () => {
    const { s } = make();
    s.select(3);
    s.select(4);
    s.answer(1);
    expect(s.settled).toBe(false);
    s.answer(2);
    expect(s.settled).toBe(true);
  });
});
