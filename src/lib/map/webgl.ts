/**
 * Spec §4.9 probe, run before MapLibre is imported. False without a DOM. The probe's context is
 * released immediately so it does not count against the browser's live WebGL context limit.
 */
export function hasWebGL2(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
