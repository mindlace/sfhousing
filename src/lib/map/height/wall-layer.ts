/**
 * LidWallLayer (height-lids spec, "Walls"): a faint neutral face where the limit steps between two
 * adjacent regions, one vertical quad per wall segment from the lower lid height to the higher.
 * One instance per LidWalls segment: a triangle-strip unit quad whose u runs from end a to end b
 * and v from zLo to zHi.
 *
 * Depth tested against the buildings drawn before it but never written, both faces drawn: a
 * building in front hides the wall, and later layers are not cut by it.
 */
import { Layer, project32, type LayerProps, type UpdateParameters } from '@deck.gl/core';
import type { Attribute } from '@deck.gl/core';
import { Geometry, Model } from '@luma.gl/engine';
import type { ShaderModule } from '@luma.gl/shadertools';
import type { RGBA } from '../palette';
import type { LidWalls } from './types';

export interface LidWallLayerProps extends LayerProps {
  data: LidWalls;
  /** 0–255, from the 'limit-wall' token. */
  color: RGBA;
  /** Per wall, × the colour's alpha. */
  alpha: Float32Array;
}

type LidWallModuleProps = { color: [number, number, number, number] };

const uniformBlock = /* glsl */ `\
layout(std140) uniform lidWallUniforms {
  vec4 color;
} lidWall;
`;

const lidWallModule = {
  name: 'lidWall',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: { color: 'vec4<f32>' }
} as const satisfies ShaderModule<LidWallModuleProps>;

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME lid-wall-layer-vertex-shader

in vec2 positions; // quad corner (u, v): u 0 at end a → 1 at end b, v 0 at zLo → 1 at zHi
in vec2 instanceA; // end a, lng/lat
in vec2 instanceA64Low;
in vec2 instanceDelta; // b − a, degrees
in vec2 instanceZ; // zLo, zHi metres
in float instanceAlpha;

out vec4 vColor;

void main(void) {
  float z = mix(instanceZ.x, instanceZ.y, positions.y);
  // The along-wall offset goes on the low part, so a wall end shared by two
  // segments comes out the same from both. Below zoom 12 deck projects without offsets and
  // ignores the low part: there the offset joins the high part.
  vec2 offset = positions.x * instanceDelta;
  vec3 hi = vec3(instanceA, z);
  vec3 lo = vec3(instanceA64Low, 0.0);
  if (project.projectionMode == PROJECTION_MODE_WEB_MERCATOR_AUTO_OFFSET) {
    lo.xy += offset;
  } else {
    hi.xy += lo.xy + offset;
    lo.xy = vec2(0.0);
  }
  vec4 commonPos;
  gl_Position = project_position_to_clipspace(hi, lo, vec3(0.0), commonPos);
  geometry.position = commonPos;
  vColor = vec4(lidWall.color.rgb, lidWall.color.a * instanceAlpha * layer.opacity);
}
`;

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME lid-wall-layer-fragment-shader

precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main(void) {
  fragColor = vColor;
}
`;

/** Fixed props: never picked, depth tested but never written, both faces. */
const FIXED = {
  pickable: false,
  parameters: { depthWriteEnabled: false, depthCompare: 'less-equal', cullMode: 'none' }
} as const satisfies Partial<LayerProps>;

export class LidWallLayer extends Layer<LidWallLayerProps> {
  static layerName = 'LidWallLayer';

  declare state: {
    model?: Model;
    /** The one `lidWall` props object `draw` mutates in place (no per-draw allocation). */
    uniforms?: { lidWall: LidWallModuleProps };
  };

  constructor(...propObjects: Partial<LidWallLayerProps>[]) {
    super(...propObjects, FIXED);
  }

  getShaders() {
    return super.getShaders({ vs, fs, modules: [project32, lidWallModule] });
  }

  getNumInstances(): number {
    return this.props.data?.count ?? 0;
  }

  initializeState() {
    // The updaters read the `props` deck passes them, never `this`: deck carries this state over
    // to each new layer instance, so a closure over `this` would keep the first layer's data.
    this.getAttributeManager()!.addInstanced({
      instanceA: {
        size: 2,
        type: 'float64',
        fp64: this.use64bitPositions(),
        update: (attribute: Attribute, { props }: { props: LidWallLayerProps }) => {
          attribute.value = props.data.a;
        }
      },
      instanceDelta: {
        size: 2,
        update: (attribute: Attribute, { props }: { props: LidWallLayerProps }) => {
          const { a, b, count } = props.data;
          const d = new Float32Array(2 * count);
          for (let i = 0; i < 2 * count; i++) d[i] = b[i] - a[i];
          attribute.value = d;
        }
      },
      instanceZ: {
        size: 2,
        update: (attribute: Attribute, { props }: { props: LidWallLayerProps }) => {
          const { zLo, zHi, count } = props.data;
          const z = new Float32Array(2 * count);
          for (let i = 0; i < count; i++) {
            z[2 * i] = zLo[i];
            z[2 * i + 1] = zHi[i];
          }
          attribute.value = z;
        }
      },
      instanceAlpha: {
        size: 1,
        update: (attribute: Attribute, { props }: { props: LidWallLayerProps }) => {
          attribute.value = props.alpha;
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
    // alpha is not data: a new alpha array (a mode change) re-uploads it alone
    if (params.props.alpha !== params.oldProps.alpha && !params.changeFlags.dataChanged)
      this.getAttributeManager()!.invalidate('instanceAlpha');
  }

  draw() {
    const { model } = this.state;
    if (!model) return;
    const { color } = this.props;
    // luma copies the values, so one object per layer, mutated in place, serves every draw.
    const u = (this.state.uniforms ??= { lidWall: { color: [0, 0, 0, 0] } });
    const c = u.lidWall.color;
    c[0] = color[0] / 255;
    c[1] = color[1] / 255;
    c[2] = color[2] / 255;
    c[3] = color[3] / 255;
    model.shaderInputs.setProps(u);
    model.draw(this.context.renderPass);
  }

  private _getModel(): Model {
    // Triangle strip over the unit quad: (0,0) (1,0) (0,1) (1,1): a-low, b-low, a-high, b-high.
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
