// HaloLayer (map-on-screen slice 5): one instanced screen-space diamond per policy mark. The
// vertex shader evaluates the record on `clock.day` (`hl_evalHalo`, a rule-for-rule port of
// `evalHalo` in halos.ts: keep the rule order identical) and hides what it does not show; the
// fragment shader fills the diamond in the accent with a 1 px land-coloured edge. Modelled on
// StageBarLayer: `draw` reads the shared clock, so `setTime` sets no prop and nothing here runs
// per project in JS per frame.
import {
  Layer,
  project32,
  type DefaultProps,
  type LayerProps,
  type UpdateParameters
} from '@deck.gl/core';
import { Geometry, Model } from '@luma.gl/engine';
import type { ShaderModule } from '@luma.gl/shadertools';
import { MARK_AREA_ZOOM, MARK_PX } from './constants';
import type { HaloAttrs } from './halos';
import type { TimelineClock } from './types';
import { TOKENS, hexToRgba, type TokenName } from '../palette';
import type { Theme } from '../types';

type Rgb = [number, number, number];

/** Uniforms of the `halo` module. Colours are 0–1 sRGB. */
export type HaloModuleProps = {
  day: number;
  policy: Rgb;
  land: Rgb;
};

/** A float literal GLSL accepts (always has a decimal point). */
const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// std140; field order matches `uniformTypes` (luma lays the block out from that order).
const uniformBlock = /* glsl */ `\
layout(std140) uniform haloUniforms {
  float day;
  vec3 policy;
  vec3 land;
} halo;
`;

const haloModule = {
  name: 'halo',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    day: 'f32',
    policy: 'vec3<f32>',
    land: 'vec3<f32>'
  }
} as const satisfies ShaderModule<HaloModuleProps>;

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME halo-layer-vertex-shader

in vec2 positions; // quad corner: -1 → 1 on each axis
in vec3 instanceAnchor;
in vec3 instanceAnchor64Low;
in vec2 instanceHalo; // day, until
in float instanceAreaFrom; // the mark's areaFrom

flat out float vSize;
out vec2 vPx;
flat out float vAlpha;

const float HL_MARK_PX = ${glslFloat(MARK_PX)};
// 2^MARK_AREA_ZOOM: compared with project.scale, so the gate is exact at an integer zoom.
const float HL_MARK_AREA_SCALE = ${glslFloat(2 ** MARK_AREA_ZOOM)};

// The mark on day t at map scale 'scale' (2^zoom). Port of evalHalo.
bool hl_evalHalo(float day, float until, float areaFrom, float t, float scale) {
  return day <= t && t < until && (scale >= HL_MARK_AREA_SCALE || t >= areaFrom);
}

void main(void) {
  bool visible = hl_evalHalo(
    instanceHalo.x, instanceHalo.y, instanceAreaFrom, halo.day, project.scale
  );
  // Half the diamond's diagonal, plus a pixel of margin.
  float halfPx = HL_MARK_PX / 2.0 + 1.0;

  vec4 anchorCommon;
  vec4 anchor = project_position_to_clipspace(
    instanceAnchor, instanceAnchor64Low, vec3(0.0), anchorCommon
  );
  geometry.position = anchorCommon;
  // project_pixel_size_to_clipspace is exact at the focal plane's w; rescaling to the anchor's w
  // keeps the mark 'halfPx' px at any distance.
  vec2 offsetPx = positions * halfPx;
  gl_Position = anchor;
  gl_Position.xy += project_pixel_size_to_clipspace(offsetPx) * (anchor.w / project.focalDistance);

  // The diamond is symmetric about the anchor, so the sign of y does not matter.
  vPx = offsetPx;
  vSize = HL_MARK_PX;
  vAlpha = layer.opacity;
  // A hidden mark produces no fragments.
  if (!visible) {
    gl_Position = vec4(0.0);
  }
}
`;

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME halo-layer-fragment-shader

precision highp float;

in vec2 vPx;
flat in float vSize;
flat in float vAlpha;

out vec4 fragColor;

void main(void) {
  // A diamond of diagonal vSize: inside where |x| + |y| <= vSize / 2. The band within 1 px
  // (perpendicular) of its edge is land-coloured, so the mark reads over any building.
  float d = (abs(vPx.x) + abs(vPx.y) - vSize / 2.0) * 0.70710678;
  if (d > 0.0) discard;
  fragColor = vec4(d > -1.0 ? halo.land : halo.policy, vAlpha);
}
`;

const srgb01 = (theme: Theme, name: TokenName): Rgb =>
  hexToRgba(TOKENS[theme][name])
    .slice(0, 3)
    .map((v) => v / 255) as Rgb;

/** The halo colours, 0-1 sRGB. */
export type HaloColours = Omit<HaloModuleProps, 'day'>;

/** Per-theme colour uniforms, built once at module load. */
export const HALO_COLOURS: Record<Theme, HaloColours> = {
  light: colours('light'),
  dark: colours('dark')
};
function colours(theme: Theme): HaloColours {
  return {
    policy: srgb01(theme, 'tl-halo-policy'),
    land: srgb01(theme, 'land')
  };
}

/** Props added by HaloLayer. */
type _HaloLayerProps = {
  data: HaloAttrs[];
  /** Shared clock, mutated in place by `setTime`; `draw` reads `day` and `theme`. */
  clock: TimelineClock;
};

export type HaloLayerProps = _HaloLayerProps & LayerProps;

const defaultProps: DefaultProps<HaloLayerProps> = {
  // Identity compares: the same clock mutated in place is not a change.
  clock: { type: 'object', value: null as unknown as TimelineClock }
};

/** Fixed props: one halo layer per map, never picked, drawn over everything without depth. */
const FIXED = {
  id: 'timeline-halos',
  pickable: false,
  parameters: { depthWriteEnabled: false, depthCompare: 'always' }
} as const satisfies Partial<LayerProps>;

export class HaloLayer extends Layer<_HaloLayerProps> {
  static layerName = 'HaloLayer';
  static defaultProps = defaultProps;

  declare state: {
    model?: Model;
    /** The one `halo` props object `draw` mutates in place (no per-draw allocation). */
    uniforms?: { halo: HaloModuleProps };
  };

  constructor(...propObjects: Partial<HaloLayerProps>[]) {
    super(...propObjects, FIXED);
  }

  getShaders() {
    return super.getShaders({ vs, fs, modules: [project32, haloModule] });
  }

  initializeState() {
    this.getAttributeManager()!.addInstanced({
      instanceAnchor: {
        size: 3,
        type: 'float64',
        fp64: this.use64bitPositions(),
        accessor: (h: HaloAttrs) => [h.anchor[0], h.anchor[1], 0]
      },
      instanceHalo: { size: 2, accessor: (h: HaloAttrs) => [h.day, h.until] },
      instanceAreaFrom: { size: 1, accessor: (h: HaloAttrs) => h.areaFrom }
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
    const { clock } = this.props;
    // luma copies the values, so one object per layer, mutated in place, serves every draw.
    const u = (this.state.uniforms ??= { halo: { day: 0, ...HALO_COLOURS.light } });
    const h = u.halo;
    const c = HALO_COLOURS[clock.theme];
    h.day = clock.day;
    h.policy = c.policy;
    h.land = c.land;
    model.shaderInputs.setProps(u);
    model.draw(this.context.renderPass);
  }

  private _getModel(): Model {
    // Triangle strip over the quad: (-1,-1) (1,-1) (-1,1) (1,1).
    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
      geometry: new Geometry({
        topology: 'triangle-strip',
        attributes: {
          positions: { size: 2, value: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) }
        }
      }),
      isInstanced: true
    });
  }
}
