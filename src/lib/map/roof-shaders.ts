// Local east/north/up metres, with the same Gouraud material/light modules as generated solids.
export const roofUniforms = {
  name: 'roof',
  vs: `layout(std140) uniform roofUniforms { vec4 color;
float isActive;
 } roof;`,
  fs: `layout(std140) uniform roofUniforms { vec4 color;
float isActive;
 } roof;`,
  uniformTypes: { color: 'vec4<f32>', isActive: 'f32' }
} as const;

export const roofVertexShader = `#version 300 es
in vec3 positions;
in vec3 normals;
in vec3 pickingColors;
in float visibility;
out vec4 vColor;
flat out float vVisible;
void main() {
  geometry.worldPosition = positions;
  geometry.pickingColor = pickingColors;
  geometry.normal = project_normal(normals);
  gl_Position = project_position_to_clipspace(positions, vec3(0.), vec3(0.), geometry.position);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vColor = vec4(lighting_getLightColor(roof.color.rgb, project.cameraPosition,
    geometry.position.xyz, geometry.normal), roof.color.a * layer.opacity);
  vVisible = visibility;
  DECKGL_FILTER_COLOR(vColor, geometry);
}`;

export const roofFragmentShader = `#version 300 es
precision highp float;
in vec4 vColor;
flat in float vVisible;
out vec4 fragColor;
void main() {
  if (roof.isActive < 0.5 || vVisible < 0.5) discard;
  geometry.uv = vec2(0.);
  fragColor = vColor;
  DECKGL_FILTER_COLOR(fragColor, geometry);
}`;
