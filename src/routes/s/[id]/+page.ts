// /s/[id] (plan 5, Task 6; I16): the shared policy runs on its own dataset version when that
// manifest exists, else on the current one (Call 9). Manifest and calibration failures are flags,
// never a thrown 500, as on /sim. The page opens the server's text (timeline-ui Task 15, R-4): with
// the calibration loaded, here, and a text that will not open is the policy's 500; with none, the
// text goes on and SimPage opens it after a Retry's reload. The URL names no future.
import { error } from '@sveltejs/kit';
import { copyFor } from '$lib/sharing/copy';
import { loadSimScenario } from '$lib/sim-page/load';
import { openShared, type SimNotice4 } from '$lib/timeline/session4';
import type { SimDoc4 } from '$lib/timeline/sim-doc4';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data, fetch }) => {
  const scenario = await loadSimScenario(
    data.doc.datasetVersion,
    data.currentDatasetVersion,
    fetch
  );
  // The manifest's version: the document's own, or current on fallback. With no manifest, the
  // server's notice says which one a Retry should ask for.
  const datasetVersion =
    scenario.manifest?.datasetVersion ??
    (data.datasetNotice === 'gone' ? data.currentDatasetVersion : data.doc.datasetVersion);
  const cal = scenario.calibration;
  let opened: { doc: SimDoc4; notices: SimNotice4[] } | null = null;
  if (cal) {
    const r = openShared(data.doc.text, { asOf: cal.asOf, calibration: cal }, data.upgradedFrom);
    if (!r.ok) error(500, copyFor('sim').unparsable);
    opened = { doc: r.doc, notices: r.notices };
  }
  return { ...data, ...scenario, datasetVersion, opened };
};
