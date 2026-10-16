/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { tinyNetwork } from './fixtures/transit-tiny';
import { TransitFormatError, decodeTransit, encodeTransit } from './transit-codec';

const wire = () => JSON.parse(encodeTransit(tinyNetwork())) as Record<string, unknown>;

describe('sfh-transit/1 codec', () => {
  it('round-trips a network already at wire precision', () => {
    expect(decodeTransit(encodeTransit(tinyNetwork()))).toEqual(tinyNetwork());
  });

  it('accepts a parsed object as well as a string', () => {
    expect(decodeTransit(wire())).toEqual(tinyNetwork());
  });

  it('is columnar: stops are parallel arrays, coordinates and tph are integers', () => {
    const w = wire() as { stops: { lng: number[] }; patterns: { tph: number[] }[] };
    expect(w.stops.lng).toEqual([-122418000, -122419500]);
    expect(w.patterns[1].tph).toEqual([65]);
  });

  it.each([
    ['unknown format', (w: any) => (w.format = 'sfh-transit/2'), /unknown format/],
    ['stop index out of range', (w: any) => (w.patterns[0].stops = [9]), /stop index/],
    ['unknown vehicle', (w: any) => (w.patterns[0].vehicle = 'nope'), /vehicle/],
    ['negative tph', (w: any) => (w.patterns[0].tph = [-1]), /tph/],
    ['mismatched stop columns', (w: any) => w.stops.name.pop(), /stops\.name/],
    ['bad mode', (w: any) => (w.patterns[0].mode = 'ferry'), /mode/],
    ['bad direction', (w: any) => (w.patterns[0].direction = 2), /direction/],
    ['bad operator index', (w: any) => (w.patterns[0].operator = 5), /operator/]
  ])('rejects %s', (_name, mutate, msg) => {
    const w = wire();
    mutate(w);
    expect(() => decodeTransit(w)).toThrow(TransitFormatError);
    expect(() => decodeTransit(w)).toThrow(msg);
  });

  it('rejects a vehicle name that is only an Object.prototype member', () => {
    const w = wire() as any;
    w.patterns[0].vehicle = 'toString';
    expect(() => decodeTransit(w)).toThrow(/vehicle/);
  });

  it('keeps a vehicle keyed __proto__ as an ordinary entry', () => {
    const w = wire() as any;
    const text = JSON.stringify(w).replace(
      '"vehicles":{',
      '"vehicles":{"__proto__":{"label":"odd","seats":null,"capacity":10},'
    );
    const t = JSON.parse(text);
    t.patterns[0].vehicle = '__proto__';
    const net = decodeTransit(JSON.stringify(t));
    expect(Object.hasOwn(net.vehicles, '__proto__')).toBe(true);
    expect(net.vehicles[net.patterns[0].vehicle].capacity).toBe(10);
  });

  it('rejects invalid JSON text', () => {
    expect(() => decodeTransit('{')).toThrow(/invalid JSON/);
  });
});
