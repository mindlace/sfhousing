import { describe, expect, it } from 'vitest';
import { covers, APP_RESOURCE, type ResourceRef } from './resource';

const sim = (id: string): ResourceRef => ({ type: 'sim', id });

describe('covers', () => {
  it('app:* covers any resource', () => {
    expect(covers(APP_RESOURCE, sim('s1'))).toBe(true);
    expect(covers(APP_RESOURCE, sim('s2'))).toBe(true);
  });

  it('a resource covers itself', () => {
    expect(covers(sim('s1'), sim('s1'))).toBe(true);
  });

  it('a resource covers a target that lists it as an ancestor', () => {
    expect(covers(sim('s1'), sim('s2'), [sim('s1')])).toBe(true);
  });

  it('a sim does NOT cover a target whose ancestors are a different sim', () => {
    expect(covers(sim('s2'), sim('s3'), [sim('s1')])).toBe(false);
  });

  it('a sim does NOT cover a bare target with no ancestors', () => {
    expect(covers(sim('s1'), sim('s2'))).toBe(false);
  });

  it('different ids of the same type do not cover', () => {
    expect(covers(sim('s1'), sim('s2'))).toBe(false);
  });

  it('an app resource with another id is not the root', () => {
    expect(covers({ type: 'app', id: 'x' }, sim('s1'))).toBe(false);
  });
});
