import { expect, test } from '@playwright/test';
import { gotoEditor, type Win } from './helpers/sharing';
for (const theme of ['light', 'dark'] as const)
  for (const stories of [5, 6, 8, 12, 20, 40]) {
    test(`${theme} elevated composition district at ${stories} floors`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await gotoEditor(page);
      const result = await page.evaluate(async (s) => {
        const map = (window as Win).__sfhMap!;
        const result = await map.loadCompositionDistrict(42, s);
        await new Promise<void>((resolve) => {
          map.map!.once('idle', () => resolve());
          map.map!.jumpTo({
            center: [-122.4194, 37.7749],
            zoom: s >= 13 ? 16.3 : 17.3,
            pitch: 55,
            bearing: -20
          });
        });
        return result;
      }, stories);
      expect(result.parcels).toBeGreaterThan(40);
      await page.waitForFunction(() => ((window as Win).__sfhMap!.snapshot()?.pending ?? 1) === 0);
      const totals = await page.evaluate(() => (window as Win).__sfhMap!.generatedParcels());
      expect(totals).toHaveLength(result.parcels);
      expect(totals.every((p) => p.units > 0)).toBe(true);
      await page
        .getByTestId('map-root')
        .screenshot({ path: info.outputPath(`district-${theme}-${stories}.png`) });
    });
  }
