/**
 * HeightFogLayer (sim map overlays spec §4): the worker's height-limit grid drawn as a translucent
 * smoothed surface at the allowed height. One instance per FogInstances cell, a triangle-strip
 * unit quad whose corners take the cell's four corner heights.
 *
 * Depth tested against the buildings drawn before it but never written: a roof above the fog
 * stays clear, one below shows through it, and later layers are not cut by it.
 */
import { Layer, project32, type LayerProps, type UpdateParameters } from '@deck.gl/core';
import type { Attribute } from '@deck.gl/core';
import { Geometry, Model } from '@luma.gl/engine';
import type { ShaderModule } from '@luma.gl/shadertools';
import { FOG_CELL_M, type FogGrid, type FogInstances } from './grid';
import { TOKENS, hexToRgba } from '../palette';
import type { Theme } from '../types';

export const FOG_LAYER_ID = 'sim-height-fog';

export interface HeightFogLayerProps extends LayerProps {
  data: FogInstances;
  cellDeg: [dLng: number, dLat: number];
  color: [number, number, number, number]; // 0–255, from the 'height-fog' token
}

type HeightFogModuleProps = {
  color: [number, number, number, number];
  cellDeg: [number, number];
};

const uniformBlock = /* glsl */ `\
layout(std140) uniform heightFogUniforms {
  vec4 color;
  vec2 cellDeg;
} heightFog;
`;

const heightFogModule = {
  name: 'heightFog',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: { color: 'vec4<f32>', cellDeg: 'vec2<f32>' }
} as const satisfies ShaderModule<HeightFogModuleProps>;

/** A float literal GLSL accepts (always has a decimal point). */
const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME height-fog-layer-vertex-shader

in vec2 positions; // quad corner (u, v): u 0 west → 1 east, v 0 south → 1 north
in vec2 instanceAnchor; // the cell's south-west corner, lng/lat
in vec2 instanceAnchor64Low;
in vec4 instanceCorners; // metres: SW, SE, NW, NE

out vec4 vColor;

const float HF_CELL_M = ${glslFloat(FOG_CELL_M)};

void main(void) {
  vec4 h = instanceCorners;
  float z = mix(mix(h.x, h.y, positions.x), mix(h.z, h.w, positions.x), positions.y);

  // The corner offset goes on the anchor's low part, so a corner shared by two cells comes out
  // the same from both and neighbours meet without cracks. Below zoom 12 deck projects without
  // offsets and ignores the low part: there the offset joins the high part (a shared corner then
  // rounds to the neighbour's anchor, within one float ulp).
  vec2 offset = positions * heightFog.cellDeg;
  vec3 hi = vec3(instanceAnchor, z);
  vec3 lo = vec3(instanceAnchor64Low, 0.0);
  if (project.projectionMode == PROJECTION_MODE_WEB_MERCATOR_AUTO_OFFSET) {
    lo.xy += offset;
  } else {
    hi.xy += lo.xy + offset;
    lo.xy = vec2(0.0);
  }
  vec4 commonPos;
  gl_Position = project_position_to_clipspace(hi, lo, vec3(0.0), commonPos);
  geometry.position = commonPos;

  // Slope shading: the quad's normal from its four corners, one per cell. Flat is the token.
  float gx = ((h.y - h.x) + (h.w - h.z)) * 0.5 / HF_CELL_M;
  float gy = ((h.z - h.x) + (h.w - h.y)) * 0.5 / HF_CELL_M;
  vec3 n = normalize(vec3(-gx, -gy, 1.0));
  vColor = vec4(heightFog.color.rgb * mix(0.82, 1.0, n.z), heightFog.color.a * layer.opacity);
}
`;

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME height-fog-layer-fragment-shader

precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main(void) {
  fragColor = vColor;
}
`;

/** Fixed props: one fog layer, never picked, depth tested but never written, both faces. */
const FIXED = {
  id: FOG_LAYER_ID,
  pickable: false,
  parameters: { depthWriteEnabled: false, depthCompare: 'less-equal', cullMode: 'none' }
} as const satisfies Partial<LayerProps>;

export class HeightFogLayer extends Layer<HeightFogLayerProps> {
  static layerName = 'HeightFogLayer';

  declare state: {
    model?: Model;
    /** The one `heightFog` props object `draw` mutates in place (no per-draw allocation). */
    uniforms?: { heightFog: HeightFogModuleProps };
  };

  constructor(...propObjects: Partial<HeightFogLayerProps>[]) {
    super(...propObjects, FIXED);
  }

  getShaders() {
    return super.getShaders({ vs, fs, modules: [project32, heightFogModule] });
  }

  getNumInstances(): number {
    return this.props.data?.count ?? 0;
  }

  initializeState() {
    this.getAttributeManager()!.addInstanced({
      instanceAnchor: {
        size: 2,
        type: 'float64',
        fp64: this.use64bitPositions(),
        update: (attribute: Attribute) => {
          attribute.value = this.props.data.anchors;
        }
      },
      instanceCorners: {
        size: 4,
        update: (attribute: Attribute) => {
          attribute.value = this.props.data.corners;
        }
      }
    });
  }

  updateState(params: UpdateParameters<this>) {
    super.updateState(params);
    if (params.changeFlags.extensionsChanged) {
      this.state.model?.destroy();
      this.state.model = this._getModel();
      this.getAttributeManager()!.invalidateAll();
    }
  }

  draw() {
    const { model } = this.state;
    if (!model) return;
    const { color, cellDeg } = this.props;
    // luma copies the values, so one object per layer, mutated in place, serves every draw.
    const u = (this.state.uniforms ??= { heightFog: { color: [0, 0, 0, 0], cellDeg: [0, 0] } });
    const hf = u.heightFog;
    hf.color[0] = color[0] / 255;
    hf.color[1] = color[1] / 255;
    hf.color[2] = color[2] / 255;
    hf.color[3] = color[3] / 255;
    hf.cellDeg[0] = cellDeg[0];
    hf.cellDeg[1] = cellDeg[1];
    model.shaderInputs.setProps(u);
    model.draw(this.context.renderPass);
  }

  private _getModel(): Model {
    // Triangle strip over the unit quad: (0,0) (1,0) (0,1) (1,1), the SW, SE, NW, NE corners.
    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
      geometry: new Geometry({
        topology: 'triangle-strip',
        attributes: { positions: { size: 2, value: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]) } }
      }),
      isInstanced: true
    });
  }
}

/** The fog layer for `fi` (cells of `g`) in `theme`'s 'height-fog' colour. */
export function heightFogLayer(fi: FogInstances, g: FogGrid, theme: Theme): HeightFogLayer {
  return new HeightFogLayer({
    data: fi,
    cellDeg: [g.dLng, g.dLat],
    color: hexToRgba(TOKENS[theme]['height-fog'])
  });
}
