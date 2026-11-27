// The mini fixture's DGS CCCI source (dgs-ccci): invented test values in the fetcher's CSV
// layout, 1,000 in 2007 rising 50 a year, January and July. Not the index's values.
import { ccciCsv } from '../../../sources/dgs';

export const CCCI_CSV = ccciCsv(
  Array.from({ length: 20 }, (_, i) => 2007 + i).flatMap((year) => [
    { year, month: 1, value: 1000 + 50 * (year - 2007) },
    { year, month: 7, value: 1020 + 50 * (year - 2007) }
  ])
);
