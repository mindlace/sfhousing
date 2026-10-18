/**
 * Provenance source helpers (evidence hierarchy: every Provenance has at least one source with an
 * https URL). Dataset ids are the DataSF datasets the calibration reads; the literature URLs are
 * from docs/superpowers/research/2026-10-16-fzp-calibration-literature.md.
 */
export const DATASETS = {
  planningProjects: 'qvu5-m3a2',
  planningRecords: 'y673-d69b',
  planningReview: 'd4jk-jw33',
  permits: 'i98e-djp9',
  unitCompletions: 'j67f-aayr',
  housingProduction: 'xdht-4php',
  assessorRoll: 'wv5m-vpq2',
  devPipeline: '6jgi-cpb4'
} as const;

const LABELS: Record<keyof typeof DATASETS, string> = {
  planningProjects: 'SF Planning projects (DataSF qvu5-m3a2)',
  planningRecords: 'SF Planning records, including PPAs (DataSF y673-d69b)',
  planningReview: 'SF Planning review and approvals (DataSF d4jk-jw33)',
  permits: 'SF building permits (DataSF i98e-djp9)',
  unitCompletions: 'SF housing unit completions (DataSF j67f-aayr)',
  housingProduction: 'SF housing production (DataSF xdht-4php)',
  assessorRoll: 'SF assessor secured roll (DataSF wv5m-vpq2)',
  devPipeline: 'SF development pipeline (DataSF 6jgi-cpb4)'
};

/** A DataSF dataset as a provenance source. */
export function datasf(id: keyof typeof DATASETS): { label: string; url: string } {
  return { label: LABELS[id], url: `https://data.sf.gov/d/${DATASETS[id]}` };
}

export const HCD_POLICY_REVIEW = {
  label: 'HCD: San Francisco housing policy and practice review',
  url: 'https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/plan-report/sf-housing-policy-and-practice-review.pdf'
} as const;

export const KQED_PERMIT_TIMES = {
  label: 'KQED: San Francisco building permit times',
  url: 'https://www.kqed.org/news/12075520'
} as const;

export const HOUSING_INVENTORY_2025 = {
  label: 'SF Planning: 2025 Housing Inventory',
  url: 'https://sfplanning.org/sites/default/files/resources/2026-04/2025_Housing_Inventory.pdf'
} as const;

export const EYE_ON_HOUSING_2026_09 = {
  label: 'NAHB Eye on Housing: shorter apartment construction time in 2025 (2026-09)',
  url: 'https://eyeonhousing.org/2026/09/shorter-apartment-construction-time-in-2025/'
} as const;

export const HOUSING_ELEMENT_APPENDIX_B = {
  label: 'SF Housing Element, Appendix B: sites inventory',
  url: 'https://sfplanning.org/sites/default/files/documents/citywide/housing-choice/housingchoice_element_appendixB_sites_inventory.pdf'
} as const;

export const PLANNING_DIRECTOR_BULLETIN_11 = {
  label: 'SF Planning: Planning Director Bulletin No. 11, Housing Choice-SF program',
  url: 'https://sfplanning.org/resource/planning-director-bulletin-no-11-housing-choice-sf-program'
} as const;
