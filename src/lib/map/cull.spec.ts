import { expect, it } from 'vitest';
import { WebMercatorViewport } from '@deck.gl/core';
import { generatedCellFilter, registerCellBounds } from './cull';
import { emptyPack } from './pack';
function layerAt(lng: number, lat: number, top = 64) {
  const data = {};
  const pack = {
    ...emptyPack('a'),
    positions: new Float64Array([lng - 0.0001, lat - 0.0001, lng + 0.0001, lat + 0.0001]),
    partTopM: new Float32Array([top])
  };
  registerCellBounds(data, pack);
  return { id: 'generated-a', props: { data } };
}
it('culls only cells wholly outside the visible height volume', () => {
  const viewport = new WebMercatorViewport({
    width: 1280,
    height: 800,
    longitude: -122.401,
    latitude: 37.789,
    zoom: 15,
    pitch: 55
  });
  expect(generatedCellFilter({ layer: layerAt(-122.401, 37.789), viewport })).toBe(true);
  expect(generatedCellFilter({ layer: layerAt(-122.51, 37.71), viewport })).toBe(false);
});
it('keeps a roof visible beyond the ground-plane viewport bounds', () => {
  const viewport = new WebMercatorViewport({
    width: 800,
    height: 600,
    longitude: -122.401,
    latitude: 37.789,
    zoom: 17,
    pitch: 55
  });
  let tested = false;
  for (let i = -100; i <= 100; i++) {
    const lat = 37.789 + i * 0.00005;
    const ground = viewport.project([-122.401, lat, 0]),
      roof = viewport.project([-122.401, lat, 100]);
    const inside = (p: number[]) => p[0] > 0 && p[0] < 800 && p[1] > 0 && p[1] < 600;
    if (!inside(ground) && inside(roof)) {
      expect(generatedCellFilter({ layer: layerAt(-122.401, lat, 100), viewport })).toBe(true);
      tested = true;
    }
  }
  expect(tested).toBe(true);
});
it('keeps cells when a camera lies below their roofs and leaves other overlays alone', () => {
  const viewport = new WebMercatorViewport({
    width: 800,
    height: 600,
    longitude: -122.401,
    latitude: 37.789,
    zoom: 20,
    pitch: 55
  });
  expect(generatedCellFilter({ layer: layerAt(-122.51, 37.71, 250), viewport })).toBe(true);
  expect(generatedCellFilter({ layer: { id: 'brush', props: { data: {} } }, viewport })).toBe(true);
});
it('culls a timeline ghost layer outside the view, but never timeline-bars', () => {
  const viewport = new WebMercatorViewport({
    width: 1280,
    height: 800,
    longitude: -122.401,
    latitude: 37.789,
    zoom: 15,
    pitch: 55
  });
  const ghost = { ...layerAt(-122.51, 37.71), id: 'timeline-ghost-a' };
  expect(generatedCellFilter({ layer: ghost, viewport })).toBe(false);
  const bars = { ...layerAt(-122.51, 37.71), id: 'timeline-bars' };
  expect(generatedCellFilter({ layer: bars, viewport })).toBe(true);
});
