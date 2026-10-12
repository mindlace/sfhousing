/** Query only: this creates no shader, program or warmup draw. Safe to serialize into a page. */
export function roofGpuCapability() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { renderer: 'WebGL2 unavailable', parallel: false };
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const result = {
    renderer: String(gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
    parallel: !!gl.getExtension('KHR_parallel_shader_compile')
  };
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return result;
}
