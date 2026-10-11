/** Spec §4.9 probe, run before MapLibre is imported. False without a DOM. */
export function hasWebGL2(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}
