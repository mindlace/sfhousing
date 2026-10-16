// Test network shared by service and map specs. Five stops: s0 bus, s1 bus + 2-car light rail,
// ct-nb / ct-sb the two platforms of Caltrain station "ct" (40 trains/day each), s4 BART.
import type { Pattern, TransitNetwork } from '$lib/data/transit';

const V = {
  'muni-bus-40': { label: 'bus', seats: 30, capacity: 44 },
  'muni-lrv4': { label: 'lrv', seats: 60, capacity: 139 },
  'bart-car': { label: 'bart', seats: 54, capacity: 107 },
  'caltrain-emu7': { label: 'ct', seats: 675, capacity: 810 }
};
const stop = (id: string, stationId: string | null = null) => ({
  id,
  name: id,
  lngLat: [-122.42, 37.76] as [number, number],
  stationId,
  placeId: stationId ?? id
});
const pat = (
  p: Partial<Pattern> & Pick<Pattern, 'id' | 'mode' | 'vehicle' | 'stops'>
): Pattern => ({
  operatorId: 'muni',
  routeId: p.id,
  routeName: p.id,
  direction: 0,
  cars: 1,
  ...p
});
export function net(): TransitNetwork {
  return {
    peak: { start: '07:00', end: '09:00' },
    operators: [{ id: 'muni', label: 'Muni', serviceDate: '2026-10-13' }],
    vehicles: V,
    stops: [stop('s0'), stop('s1'), stop('ct-nb', 'ct'), stop('ct-sb', 'ct'), stop('s4')],
    patterns: [
      // Two patterns of the same route-direction both serve s0: they sum.
      pat({
        id: 'A',
        routeId: '22',
        routeName: '22',
        mode: 'bus',
        vehicle: 'muni-bus-40',
        stops: [{ stop: 0, tph: 6, tpd: 60 }]
      }),
      pat({
        id: 'B',
        routeId: '22',
        routeName: '22',
        mode: 'bus',
        vehicle: 'muni-bus-40',
        stops: [
          { stop: 0, tph: 2, tpd: 20 },
          { stop: 1, tph: 2, tpd: 20 }
        ]
      }),
      pat({
        id: 'N',
        routeId: 'N',
        mode: 'light-rail',
        vehicle: 'muni-lrv4',
        cars: 2,
        stops: [{ stop: 1, tph: 5, tpd: 90 }]
      }),
      pat({
        id: 'CTN',
        operatorId: 'caltrain',
        routeId: 'L',
        direction: 1,
        mode: 'commuter-rail',
        vehicle: 'caltrain-emu7',
        stops: [{ stop: 2, tph: 2.5, tpd: 40 }]
      }),
      pat({
        id: 'CTS',
        operatorId: 'caltrain',
        routeId: 'L',
        direction: 0,
        mode: 'commuter-rail',
        vehicle: 'caltrain-emu7',
        stops: [{ stop: 3, tph: 2.5, tpd: 40 }]
      }),
      pat({
        id: 'R',
        operatorId: 'bart',
        routeId: '7',
        routeName: 'Red',
        mode: 'heavy-rail',
        vehicle: 'bart-car',
        cars: 10,
        stops: [{ stop: 4, tph: 4, tpd: 80 }]
      })
    ]
  };
}
