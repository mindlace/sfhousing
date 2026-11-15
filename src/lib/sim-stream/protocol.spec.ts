import { describe, expect, it } from 'vitest';
import { commitsFrame, encodeFrame, parseClientFrame } from './protocol';

describe('parseClientFrame', () => {
  it('reads a resume', () => {
    expect(parseClientFrame('{"type":"resume","after":3}')).toEqual({ type: 'resume', after: 3 });
    expect(parseClientFrame('{"type":"resume","after":0}')).toEqual({ type: 'resume', after: 0 });
  });

  it.each([
    '{"type":"resume","after":-1}',
    '{"type":"resume","after":1.5}',
    '{"type":"resume"}',
    '{"type":"resume","after":"3"}',
    '{"type":"resume","after":3,"extra":1}',
    '{"type":"subscribe"}',
    '[1]',
    'null',
    'ping',
    '{'
  ])('refuses %s', (text) => {
    expect(parseClientFrame(text)).toBeNull();
  });

  it('reads an append and its id without parsing the commit', () => {
    expect(parseClientFrame('{"type":"append","commit":{"id":"abc","junk":1}}')).toEqual({
      type: 'append',
      commit: { id: 'abc', junk: 1 },
      id: 'abc'
    });
    expect(parseClientFrame('{"type":"append","commit":5}')).toEqual({
      type: 'append',
      commit: 5,
      id: null
    });
    expect(parseClientFrame('{"type":"append"}')).toBeNull();
  });

  it('gives no id longer than 64 characters', () => {
    const id = 'x'.repeat(65);
    expect(parseClientFrame(JSON.stringify({ type: 'append', commit: { id } }))).toMatchObject({
      id: null
    });
  });
});

describe('encoding', () => {
  it('splices stored bodies into a commits frame', () => {
    expect(JSON.parse(commitsFrame(['{"seq":1}', '{"seq":2}']))).toEqual({
      type: 'commits',
      commits: [{ seq: 1 }, { seq: 2 }]
    });
    expect(JSON.parse(commitsFrame([]))).toEqual({ type: 'commits', commits: [] });
  });

  it('encodes other frames as JSON', () => {
    expect(JSON.parse(encodeFrame({ type: 'refused', id: null, why: 'gone' }))).toEqual({
      type: 'refused',
      id: null,
      why: 'gone'
    });
    expect(JSON.parse(encodeFrame({ type: 'refused', id: 'a', why: 'newer' })).why).toBe('newer');
  });
});
