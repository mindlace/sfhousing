/** I12 datasetVersion pattern. The single definition; everything else re-exports it. Imports nothing (keeps zod out of worker bundles). */
export const DATASET_VERSION_RE = /^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}|fixture-\d+)$/;
