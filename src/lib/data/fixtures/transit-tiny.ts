import type { TransitNetwork } from '../transit';

/** A two-stop network at wire precision (codec and V14 tests). */
export function tinyNetwork(): TransitNetwork {
  return {
    peak: { start: '07:00', end: '09:00' },
    operators: [
      { id: 'muni', label: 'Muni', serviceDate: '2026-10-13' },
      { id: 'bart', label: 'BART', serviceDate: '2026-10-13' }
    ],
    vehicles: {
      'bart-car': { label: 'BART car', seats: 54, capacity: 107 },
      'muni-bus-40': { label: 'Muni 40 ft bus', seats: 30, capacity: 44 }
    },
    stops: [
      {
        id: 'bart:FX-1',
        name: 'Fixture Station',
        lngLat: [-122.418, 37.761],
        stationId: 'bart:FXST',
        placeId: 'bart:FXST'
      },
      {
        id: 'muni:m1',
        name: 'Mission St & 20th St',
        lngLat: [-122.4195, 37.759549],
        stationId: null,
        placeId: 'muni:m1'
      }
    ],
    patterns: [
      {
        id: 'bart:7:0:0',
        operatorId: 'bart',
        routeId: '7',
        routeName: 'Red',
        mode: 'heavy-rail',
        direction: 0,
        vehicle: 'bart-car',
        cars: 10,
        stops: [{ stop: 0, tph: 4, tpd: 8 }]
      },
      {
        id: 'muni:22:1:0',
        operatorId: 'muni',
        routeId: '22',
        routeName: '22',
        mode: 'bus',
        direction: 1,
        vehicle: 'muni-bus-40',
        cars: 1,
        stops: [{ stop: 1, tph: 6.5, tpd: 13 }]
      }
    ]
  };
}
