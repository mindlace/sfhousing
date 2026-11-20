// HaloLayer (map-on-screen slice 5): one instanced screen-space quad per halo record. The vertex
// shader evaluates the record on `clock.day` (`hl_evalHalo`, a rule-for-rule port of `evalHalo`
// in halos.ts: keep the rule order identical) and sizes the quad to it; the fragment shader
// strokes a ring 2 px wide in its stage's colour (the accent for a project under your policy),
// or fills a diamond in the accent with a 1 px land-coloured edge. Modelled on StageBarLayer:
// `draw` reads the shared clock, so `setTime` sets no prop and nothing here runs per project in
// JS per frame.
import {
  Layer,
  project32,
  type DefaultProps,
  type LayerProps,
  type UpdateParameters
} from '@deck.gl/core';
import { Geometry, Model } from '@luma.gl/engine';
import type { ShaderModule } from '@luma.gl/shadertools';
import { HALO_DAYS, HALO_R_PX, HALO_STILL_R_PX, MARK_PX } from './constants';
import { HALO_KIND, HALO_TOKEN, type HaloAttrs } from './halos';
import type { TimelineClock } from './types';
import { TOKENS, hexToRgba, type TokenName } from '../palette';
import type { Theme } from '../types';

type Rgb = [number, number, number];

/** Uniforms of the `halo` module. Colours are 0–1 sRGB. */
export type HaloModuleProps = {
  day: number;
  reduced: number; // 1 under reduced motion, else 0
  /** 2^ringMinZoom (0 for no gate): halos show while project.scale >= it, exact at the gate. */
  ringMinScale: number;
  approved: Rgb;
  started: Rgb;
  complete: Rgb;
  policy: Rgb;
  land: Rgb;
};

/** A float literal GLSL accepts (always has a decimal point). */
const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// std140; field order matches `uniformTypes` (luma lays the block out from that order).
const uniformBlock = /* glsl */ `\
layout(std140) uniform haloUniforms {
  float day;
  float reduced;
  float ringMinScale;
  vec3 approved;
  vec3 started;
  vec3 complete;
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
    reduced: 'f32',
    ringMinScale: 'f32',
    approved: 'vec3<f32>',
    started: 'vec3<f32>',
    complete: 'vec3<f32>',
    policy: 'vec3<f32>',
    land: 'vec3<f32>'
  }
} as const satisfies ShaderModule<HaloModuleProps>;

/** Half the ring's stroke, in px. */
const STROKE_HALF_PX = 1;

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME halo-layer-vertex-shader

in vec2 positions; // quad corner: -1 → 1 on each axis
in vec3 instanceAnchor;
in vec3 instanceAnchor64Low;
in vec4 instanceHalo; // day, until, kind, policy

out vec2 vPx;
flat out float vKind;
flat out float vRadius;
flat out vec4 vColor;

const float HL_HALO_DAYS = ${glslFloat(HALO_DAYS)};
const vec2 HL_HALO_R_PX = vec2(${glslFloat(HALO_R_PX[0])}, ${glslFloat(HALO_R_PX[1])});
const float HL_HALO_STILL_R_PX = ${glslFloat(HALO_STILL_R_PX)};
const float HL_MARK_PX = ${glslFloat(MARK_PX)};
const float HL_MARK = ${glslFloat(HALO_KIND.mark)};
const float HL_STROKE_HALF_PX = ${glslFloat(STROKE_HALF_PX)};

// evalHalo's HaloEval.
struct HlEval {
  bool visible;
  float radiusPx;
  float alpha;
};

// The halo on day t at map scale 'scale' (2^zoom). Port of evalHalo; zoom < ringMinZoom is
// compared as scale < 2^ringMinZoom, so the gate is exact at an integer zoom (no log2 rounding).
HlEval hl_evalHalo(float day, float until, float kind, float t, bool reduced, float scale) {
  // 1. Hidden: outside [day, until).
  if (t < day || t >= until) return HlEval(false, 0.0, 0.0);
  // 2. Below the gate (rings and marks): the city layer's merged rings stand for them.
  if (scale < halo.ringMinScale) return HlEval(false, 0.0, 0.0);
  // 3. A mark: one size, full strength.
  if (kind == HL_MARK) return HlEval(true, HL_MARK_PX, 1.0);
  // 4. Reduced motion: a still ring.
  if (reduced) return HlEval(true, HL_HALO_STILL_R_PX, 1.0);
  // 5. A ring grows and fades over its life.
  float u = (t - day) / HL_HALO_DAYS;
  return HlEval(true, HL_HALO_R_PX.x + (HL_HALO_R_PX.y - HL_HALO_R_PX.x) * u, 1.0 - u);
}

// tl-halo-policy for a project under your policy (and every mark), else the stage's tone.
vec3 hl_color(float kind, bool policy) {
  if (policy || kind == HL_MARK) return halo.policy;
  if (kind == 0.0) return halo.approved;
  if (kind == 1.0) return halo.started;
  return halo.complete;
}

void main(void) {
  float kind = instanceHalo.z;
  HlEval e = hl_evalHalo(
    instanceHalo.x, instanceHalo.y, kind, halo.day, halo.reduced > 0.5, project.scale
  );
  // Half the quad: the ring's outer edge, or half the diamond's diagonal; plus a pixel of margin.
  float halfPx = (kind == HL_MARK ? e.radiusPx / 2.0 : e.radiusPx + HL_STROKE_HALF_PX) + 1.0;

  vec4 anchorCommon;
  vec4 anchor = project_position_to_clipspace(
    instanceAnchor, instanceAnchor64Low, vec3(0.0), anchorCommon
  );
  geometry.position = anchorCommon;
  // project_pixel_size_to_clipspace is exact at the focal plane's w; rescaling to the anchor's w
  // keeps the halo 'halfPx' px at any distance.
  vec2 offsetPx = positions * halfPx;
  gl_Position = anchor;
  gl_Position.xy += project_pixel_size_to_clipspace(offsetPx) * (anchor.w / project.focalDistance);

  // Both shapes are symmetric about the anchor, so the sign of y does not matter.
  vPx = offsetPx;
  vKind = kind;
  vRadius = e.radiusPx;
  vColor = vec4(hl_color(kind, instanceHalo.w > 0.5), e.alpha * layer.opacity);
  // Rule 1: a hidden halo produces no fragments.
  if (!e.visible) {
    gl_Position = vec4(0.0);
  }
}
`;

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME halo-layer-fragment-shader

precision highp float;

in vec2 vPx;
flat in float vKind;
flat in float vRadius;
flat in vec4 vColor;

out vec4 fragColor;

const float HL_MARK = ${glslFloat(HALO_KIND.mark)};
const float HL_STROKE_HALF_PX = ${glslFloat(STROKE_HALF_PX)};

void main(void) {
  if (vKind == HL_MARK) {
    // A diamond of diagonal vRadius: inside where |x| + |y| <= vRadius / 2. The band within 1 px
    // (perpendicular) of its edge is land-coloured, so the mark reads over any building.
    float d = (abs(vPx.x) + abs(vPx.y) - vRadius / 2.0) * 0.70710678;
    if (d > 0.0) discard;
    fragColor = vec4(d > -1.0 ? halo.land : vColor.rgb, vColor.a);
    return;
  }
  // A ring: a 2 px stroke centred on the radius.
  if (abs(length(vPx) - vRadius) > HL_STROKE_HALF_PX) discard;
  fragColor = vColor;
}
`;

const srgb01 = (theme: Theme, name: TokenName): Rgb =>
  hexToRgba(TOKENS[theme][name])
    .slice(0, 3)
    .map((v) => v / 255) as Rgb;

/** The halo colours, 0-1 sRGB. */
export type HaloColours = Omit<HaloModuleProps, 'day' | 'reduced' | 'ringMinScale'>;

/** Per-theme colour uniforms, built once at module load; CityLayer draws in the same table. */
export const HALO_COLOURS: Record<Theme, HaloColours> = {
  light: colours('light'),
  dark: colours('dark')
};
function colours(theme: Theme): HaloColours {
  return {
    approved: srgb01(theme, HALO_TOKEN.approved),
    started: srgb01(theme, HALO_TOKEN.started),
    complete: srgb01(theme, HALO_TOKEN.completed),
    policy: srgb01(theme, 'tl-halo-policy'),
    land: srgb01(theme, 'land')
  };
}

/** Props added by HaloLayer. */
type _HaloLayerProps = {
  data: HaloAttrs[];
  /** Shared clock, mutated in place by `setTime`; `draw` reads `day` and `theme`. */
  clock: TimelineClock;
  /** Reduced motion: every ring still, at HALO_STILL_R_PX and full strength. */
  reduced: boolean;
  /**
   * Rings and marks show only from this zoom: CITY_HANDOVER_ZOOM while a city layer draws the
   * merged rings below it, else 0 (no gate). A uniform: changing it rebuilds nothing.
   */
  ringMinZoom: number;
};

export type HaloLayerProps = _HaloLayerProps & LayerProps;

const defaultProps: DefaultProps<HaloLayerProps> = {
  // Identity compares: the same clock mutated in place is not a change.
  clock: { type: 'object', value: null as unknown as TimelineClock },
  reduced: false,
  ringMinZoom: 0
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
      instanceHalo: {
        size: 4,
        accessor: (h: HaloAttrs) => [h.day, h.until, h.kind, h.policy ? 1 : 0]
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
    const { clock, reduced, ringMinZoom } = this.props;
    // luma copies the values, so one object per layer, mutated in place, serves every draw.
    const u = (this.state.uniforms ??= {
      halo: { day: 0, reduced: 0, ringMinScale: 0, ...HALO_COLOURS.light }
    });
    const h = u.halo;
    const c = HALO_COLOURS[clock.theme];
    h.day = clock.day;
    h.reduced = reduced ? 1 : 0;
    h.ringMinScale = ringMinZoom > 0 ? 2 ** ringMinZoom : 0;
    h.approved = c.approved;
    h.started = c.started;
    h.complete = c.complete;
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
