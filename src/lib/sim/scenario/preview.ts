// Paint feedback (map overlays plan 2, Task 6): the cap the worker's `previewBuildings` and the
// /sim page share. Worker-safe; `types.ts` stays types-only.

/**
 * The most lots one preview builds (tier 4, engineering): the page sends the lots in view nearest
 * first, and the worker builds at most this many of them in one synchronous handler. Measured
 * against `SLICE_MS` (50 ms) in `scenario-host.preview.spec.ts`.
 */
export const PREVIEW_MAX_LOTS = 300;
