// A small brush catalog for the /sim form and section tests.
import type { BrushCatalog } from '$lib/sim/levers/brushes';

export function testCatalog(over: Partial<BrushCatalog['has']> = {}): BrushCatalog {
  return {
    streetNames: ['Geary Blvd', 'Market St', 'Mission St'],
    districts: [
      {
        family: 'NC-1',
        codes: [{ code: 'NC-1', lots: 40 }]
      },
      {
        family: 'RH-1',
        codes: [
          { code: 'RH-1', lots: 1200 },
          { code: 'RH-1(D)', lots: 300 },
          { code: 'RH-1(S)', lots: 12 }
        ]
      },
      {
        family: 'RH-2',
        codes: [{ code: 'RH-2', lots: 900 }]
      }
    ],
    neighborhoods: ['Mission', 'Sunset/Parkside'],
    stops: { regionalRail: 12, metro: 40, rapidBus: 80, frequentBus: 300 },
    has: { frontage: true, transit: true, neighborhoods: true, ...over }
  };
}
