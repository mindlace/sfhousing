// StageBarLayer (spec §4.4): one instanced screen-space quad per stage bar. The vertex shader
// evaluates the bar on `clock.day` (`sb_evalBar`, a rule-for-rule port of `evalBar` in bars.ts:
// keep the rule order, the names and the straight-line shape identical) and its colour
// (`sb_barColor`, the port of `barColor`); the fragment shader draws the border, separators,
// fill and track. Model setup follows @deck.gl/layers' LineLayer; the texture binding follows
// BitmapLayer (a shader-module prop that is not a uniform becomes a binding).
// Like TimelapseExtension, nothing here handles shader errors (ruling R10): Task 11 wires the
// overlay's `deviceProps.onError`.
import {
  Layer,
  project32,
  type DefaultProps,
  type LayerProps,
  type UpdateParameters
} from '@deck.gl/core';
import type { Texture } from '@luma.gl/core';
import { Geometry, Model } from '@luma.gl/engine';
import type { ShaderModule } from '@luma.gl/shadertools';
import { BAR_GROW_ZOOMS, RAMP } from './bars';
import {
  BAR_H_PX,
  BAR_MIN_ZOOM,
  BAR_OFFSET_PX,
  BAR_W_PX,
  BAR_ZOOM_RAMP,
  COMPLETE_FADE_DAYS,
  COMPLETE_HOLD_DAYS,
  DYING_FADE_DAYS,
  DYING_HOLD_DAYS,
  FLOOR_CAP,
  RAMP_STOPS
} from './constants';
import type { ChanceTexture } from './lookups';
import type { BarAttrs, TimelineClock } from './types';
import { TOKENS, hexToRgba, type TokenName } from '../palette';
import type { Theme } from '../types';
import { MONTH_DAYS } from '$lib/timelapse/time';

/** At most 6 segments (§4.4.2): per-segment arrays travel as a vec4 plus a vec2. */
const MAX_SEGMENTS = 6;

type Rgb = [number, number, number];

/** Uniforms of the `stageBar` module. Flat colours are 0–1 sRGB; ramp stops are linear RGB. */
export type StageBarModuleProps = {
  day: number;
  track: Rgb;
  edge: Rgb;
  dead: Rgb;
  likely: Rgb;
  rampLo: Rgb;
  rampMid: Rgb;
  rampHi: Rgb;
  chanceTexture?: Texture;
};

/** A float literal GLSL accepts (always has a decimal point). */
const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// std140; field order matches `uniformTypes` (luma lays the block out from that order).
const uniformBlock = /* glsl */ `\
layout(std140) uniform stageBarUniforms {
  float day;
  vec3 track;
  vec3 edge;
  vec3 dead;
  vec3 likely;
  vec3 rampLo;
  vec3 rampMid;
  vec3 rampHi;
} stageBar;
`;

const stageBarModule = {
  name: 'stageBar',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    day: 'f32',
    track: 'vec3<f32>',
    edge: 'vec3<f32>',
    dead: 'vec3<f32>',
    likely: 'vec3<f32>',
    rampLo: 'vec3<f32>',
    rampMid: 'vec3<f32>',
    rampHi: 'vec3<f32>'
  }
} as const satisfies ShaderModule<StageBarModuleProps>;

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME stage-bar-layer-vertex-shader

in vec2 positions; // quad corner: x 0 left → 1 right, y 0 bottom → 1 top
in vec3 instanceAnchor;
in vec3 instanceAnchor64Low;
in vec4 instanceTimes; // from, to, endDay, completeDay
in vec4 instanceMeta; // endKind, segCount, minZoom, (unused)
in vec4 instanceSegEntryA; // segEntry[0..3]
in vec2 instanceSegEntryB; // segEntry[4..5]
in vec4 instanceSegTypicalA; // segTypicalDays[0..3]
in vec2 instanceSegTypicalB; // segTypicalDays[4..5]
in vec4 instanceSegRowA; // segRow[0..3]
in vec2 instanceSegRowB; // segRow[4..5]

// r8unorm, 18 rows × max(len) columns (§4.4.3); absent rows are 0.
uniform highp sampler2D chanceTexture;

out vec2 vPx;
flat out vec2 vSize;
flat out float vFill;
flat out float vSegCount;
flat out vec4 vColor;

const int SB_MAX_SEGMENTS = ${MAX_SEGMENTS};
const float SB_BAR_MIN_ZOOM = ${glslFloat(BAR_MIN_ZOOM)};
const float SB_BAR_ZOOM_RAMP = ${glslFloat(BAR_ZOOM_RAMP)};
const float SB_BAR_GROW_ZOOMS = ${glslFloat(BAR_GROW_ZOOMS)};
const vec2 SB_BAR_W_PX = vec2(${glslFloat(BAR_W_PX[0])}, ${glslFloat(BAR_W_PX[1])});
const vec2 SB_BAR_H_PX = vec2(${glslFloat(BAR_H_PX[0])}, ${glslFloat(BAR_H_PX[1])});
const float SB_BAR_OFFSET_PX = ${glslFloat(BAR_OFFSET_PX)};
const float SB_DYING_HOLD_DAYS = ${glslFloat(DYING_HOLD_DAYS)};
const float SB_DYING_FADE_DAYS = ${glslFloat(DYING_FADE_DAYS)};
const float SB_COMPLETE_HOLD_DAYS = ${glslFloat(COMPLETE_HOLD_DAYS)};
const float SB_COMPLETE_FADE_DAYS = ${glslFloat(COMPLETE_FADE_DAYS)};
const float SB_FLOOR_CAP = ${glslFloat(FLOOR_CAP)};
const float SB_MONTH_DAYS = ${glslFloat(MONTH_DAYS)};
const vec3 SB_RAMP_STOPS = vec3(${RAMP_STOPS.map(glslFloat).join(', ')});

struct SbBarAttrs {
  float from;
  float to;
  float endDay;
  float endKind;
  float completeDay;
  float segCount;
  float segEntry[SB_MAX_SEGMENTS];
  float segTypicalDays[SB_MAX_SEGMENTS];
  float segRow[SB_MAX_SEGMENTS];
  float minZoom;
};

// evalBar's BarEval; 'hasChance' false stands for chance: null.
struct SbBarEval {
  bool visible;
  float fill;
  float segCount;
  float chance;
  bool hasChance;
  bool dead;
  float alpha;
};

// T1 monthsIn: floor((day - enteredDay) / MONTH_DAYS). MONTH_DAYS is 30.436875, which float32
// cannot represent exactly, and GLSL ES division may be off by 2.5 ULP. Near a month boundary the
// quotient can therefore land just on the wrong side of an integer. The correction step compares
// m · MONTH_DAYS (a single correctly rounded product) with d and moves m by one, so the result
// matches the CPU monthsIn (double division) for integer days; the GPU spec checks this around
// k = 1, 16 and 240.
float sb_monthsIn(float enteredDay, float day) {
  float d = day - enteredDay;
  float m = floor(d / SB_MONTH_DAYS);
  if (m * SB_MONTH_DAYS > d) {
    m -= 1.0;
  } else if ((m + 1.0) * SB_MONTH_DAYS <= d) {
    m += 1.0;
  }
  return m;
}

// chanceAt: the texel at min(max(m, 0), len - 1). Short rows are padded with their last value
// and absent rows are 0 (ruling R7), so the texture width stands in for each row's len.
float sb_chanceAt(float row, float m) {
  float len = float(textureSize(chanceTexture, 0).x);
  float col = clamp(m, 0.0, len - 1.0);
  return texelFetch(chanceTexture, ivec2(int(col), int(row)), 0).r;
}

// The bar on day t at map zoom 'zoom' (§4.4). Port of evalBar.
SbBarEval sb_evalBar(SbBarAttrs b, float t, float zoom) {
  float gate = max(SB_BAR_MIN_ZOOM, b.minZoom);
  float zoomAlpha = clamp((zoom - (gate - SB_BAR_ZOOM_RAMP)) / SB_BAR_ZOOM_RAMP, 0.0, 1.0);
  bool dead = b.endKind == 2.0 && t >= b.endDay;
  bool complete = t >= b.completeDay;

  // 1. Hidden: outside [from, to) or below the zoom ramp.
  if (t < b.from || t >= b.to || zoomAlpha <= 0.0) {
    return SbBarEval(false, 0.0, b.segCount, 0.0, false, dead, 0.0);
  }

  // 2. Time alpha: the ghost's death fade after an exit, the hold and fade after completion.
  float timeAlpha = 1.0;
  if (dead) {
    float age = t - b.endDay;
    timeAlpha = age < SB_DYING_HOLD_DAYS
      ? 1.0
      : 1.0 - (age - SB_DYING_HOLD_DAYS) / SB_DYING_FADE_DAYS;
  } else if (complete) {
    float age = t - b.completeDay;
    timeAlpha = age < SB_COMPLETE_HOLD_DAYS
      ? 1.0
      : 1.0 - (age - SB_COMPLETE_HOLD_DAYS) / SB_COMPLETE_FADE_DAYS;
  }
  float alpha = zoomAlpha * timeAlpha;

  // 3. Complete: full, no chance.
  if (complete) return SbBarEval(true, 1.0, b.segCount, 0.0, false, dead, alpha);

  // 4. Fill: the last segment entered by tEff, plus the capped within-segment share.
  float tEff = b.endKind == 2.0 ? min(t, b.endDay) : t;
  int k = 0;
  for (int j = 1; j < SB_MAX_SEGMENTS; j++) {
    if (float(j) < b.segCount && b.segEntry[j] <= tEff) k = j;
  }
  float elapsed = (tEff - b.segEntry[k]) / b.segTypicalDays[k];
  float fill = (float(k) + max(0.0, min(elapsed, SB_FLOOR_CAP))) / b.segCount;

  // 5. Chance: none once dead, else the table at the months spent in the current stage.
  if (dead) return SbBarEval(true, fill, b.segCount, 0.0, false, dead, alpha);
  float chance = sb_chanceAt(b.segRow[k], sb_monthsIn(b.segEntry[k], tEff));
  return SbBarEval(true, fill, b.segCount, chance, true, dead, alpha);
}

// rampColor before the sRGB encode: piecewise linear in linear RGB, same branches.
vec3 sb_rampLinear(float c) {
  vec3 a = stageBar.rampLo;
  vec3 b = stageBar.rampLo;
  float u = 0.0;
  if (c > SB_RAMP_STOPS.x && c <= SB_RAMP_STOPS.y) {
    a = stageBar.rampLo;
    b = stageBar.rampMid;
    u = (c - SB_RAMP_STOPS.x) / (SB_RAMP_STOPS.y - SB_RAMP_STOPS.x);
  } else if (c > SB_RAMP_STOPS.y && c < SB_RAMP_STOPS.z) {
    a = stageBar.rampMid;
    b = stageBar.rampHi;
    u = (c - SB_RAMP_STOPS.y) / (SB_RAMP_STOPS.z - SB_RAMP_STOPS.y);
  } else if (c >= SB_RAMP_STOPS.z) {
    a = stageBar.rampHi;
    b = stageBar.rampHi;
  }
  return a + (b - a) * u;
}

// Linear RGB to sRGB, as bars.ts toSrgb (before its rounding to 0–255).
vec3 sb_toSrgb(vec3 v) {
  vec3 lo = 12.92 * v;
  vec3 hi = 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, vec3(lessThanEqual(v, vec3(0.0031308))));
}

// Port of barColor: tl-bar-dead once exited, tl-bar-likely when complete, else the ramp.
vec3 sb_barColor(SbBarEval e) {
  if (e.dead) return stageBar.dead;
  if (!e.hasChance) return stageBar.likely;
  return sb_toSrgb(sb_rampLinear(e.chance));
}

// barSizePx: W = 32 → 48 px and H = 6 → 8 px from z15 to z17.
vec2 sb_barSize(float zoom) {
  float g = clamp((zoom - SB_BAR_MIN_ZOOM) / SB_BAR_GROW_ZOOMS, 0.0, 1.0);
  return vec2(mix(SB_BAR_W_PX.x, SB_BAR_W_PX.y, g), mix(SB_BAR_H_PX.x, SB_BAR_H_PX.y, g));
}

void main(void) {
  // project.scale is 2^zoom (§4.0).
  float zoom = log2(project.scale);
  SbBarAttrs a = SbBarAttrs(
    instanceTimes.x,
    instanceTimes.y,
    instanceTimes.z,
    instanceMeta.x,
    instanceTimes.w,
    instanceMeta.y,
    float[SB_MAX_SEGMENTS](
      instanceSegEntryA.x, instanceSegEntryA.y, instanceSegEntryA.z, instanceSegEntryA.w,
      instanceSegEntryB.x, instanceSegEntryB.y
    ),
    float[SB_MAX_SEGMENTS](
      instanceSegTypicalA.x, instanceSegTypicalA.y, instanceSegTypicalA.z, instanceSegTypicalA.w,
      instanceSegTypicalB.x, instanceSegTypicalB.y
    ),
    float[SB_MAX_SEGMENTS](
      instanceSegRowA.x, instanceSegRowA.y, instanceSegRowA.z, instanceSegRowA.w,
      instanceSegRowB.x, instanceSegRowB.y
    ),
    instanceMeta.z
  );
  SbBarEval e = sb_evalBar(a, stageBar.day, zoom);

  vec2 size = sb_barSize(zoom);
  vec4 anchorCommon;
  vec4 anchor = project_position_to_clipspace(
    instanceAnchor, instanceAnchor64Low, vec3(0.0), anchorCommon
  );
  geometry.position = anchorCommon;
  // Bottom edge SB_BAR_OFFSET_PX above the anchor, centred on it. project_pixel_size_to_clipspace
  // is exact at the focal plane's w; rescaling to the anchor's w keeps the bar 'size' px at any
  // height above the ground.
  vec2 offsetPx = vec2((positions.x - 0.5) * size.x, SB_BAR_OFFSET_PX + positions.y * size.y);
  gl_Position = anchor;
  gl_Position.xy += project_pixel_size_to_clipspace(offsetPx) * (anchor.w / project.focalDistance);

  vPx = positions * size;
  vSize = size;
  vFill = e.fill;
  vSegCount = e.segCount;
  vColor = vec4(sb_barColor(e), e.alpha * layer.opacity);
  // Rule 1: a hidden bar produces no fragments.
  if (!e.visible) {
    gl_Position = vec4(0.0);
  }
}
`;

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME stage-bar-layer-fragment-shader

precision highp float;

in vec2 vPx;
flat in vec2 vSize;
flat in float vFill;
flat in float vSegCount;
flat in vec4 vColor;

out vec4 fragColor;

void main(void) {
  // The 1 px tl-bar-edge border, and a 1 px separator right of each segment boundary.
  bool border =
    vPx.x < 1.0 || vPx.x >= vSize.x - 1.0 || vPx.y < 1.0 || vPx.y >= vSize.y - 1.0;
  float segW = vSize.x / vSegCount;
  float boundary = floor(vPx.x / segW) * segW;
  bool separator = boundary > 0.0 && vPx.x - boundary < 1.0;
  vec3 rgb = border || separator
    ? stageBar.edge
    : vPx.x < vFill * vSize.x ? vColor.rgb : stageBar.track;
  fragColor = vec4(rgb, vColor.a);
}
`;

const srgb01 = (theme: Theme, name: TokenName): Rgb =>
  hexToRgba(TOKENS[theme][name])
    .slice(0, 3)
    .map((v) => v / 255) as Rgb;

/** Per-theme colour uniforms (§4.6), built once at module load. */
const COLOURS: Record<Theme, Omit<StageBarModuleProps, 'day' | 'chanceTexture'>> = {
  light: colours('light'),
  dark: colours('dark')
};
function colours(theme: Theme) {
  const [rampLo, rampMid, rampHi] = RAMP[theme] as Rgb[];
  return {
    track: srgb01(theme, 'tl-bar-track'),
    edge: srgb01(theme, 'tl-bar-edge'),
    dead: srgb01(theme, 'tl-bar-dead'),
    likely: srgb01(theme, 'tl-bar-likely'),
    rampLo,
    rampMid,
    rampHi
  };
}

/** `values` padded with 0 to MAX_SEGMENTS, sliced to [start, end). */
const segs = (values: number[], start: number, end: number) =>
  Array.from({ length: end - start }, (_, i) => values[start + i] ?? 0);

/** Props added by StageBarLayer. */
type _StageBarLayerProps = {
  data: BarAttrs[];
  /** The packed chance table; a new object re-uploads the texture (§4.4.3). */
  chance: ChanceTexture;
  /** Shared clock, mutated in place by `setTime`; `draw` reads `day` and `theme`. */
  clock: TimelineClock;
};

export type StageBarLayerProps = _StageBarLayerProps & LayerProps;

const defaultProps: DefaultProps<StageBarLayerProps> = {
  // Identity compares: a new object is a change, the same object mutated in place is not.
  chance: { type: 'object', value: null as unknown as ChanceTexture },
  clock: { type: 'object', value: null as unknown as TimelineClock }
};

/**
 * Fixed props: one bar layer per map, never picked, depth tested against the buildings but never
 * written, so ghosts and other bars behind it still draw (§4.4.1).
 */
const FIXED = {
  id: 'timeline-bars',
  pickable: false,
  parameters: { depthWriteEnabled: false, depthCompare: 'less-equal' }
} as const satisfies Partial<LayerProps>;

export class StageBarLayer extends Layer<_StageBarLayerProps> {
  static layerName = 'StageBarLayer';
  static defaultProps = defaultProps;

  declare state: {
    model?: Model;
    chanceTexture?: Texture;
  };

  constructor(...propObjects: Partial<StageBarLayerProps>[]) {
    super(...propObjects, FIXED);
  }

  getShaders() {
    return super.getShaders({ vs, fs, modules: [project32, stageBarModule] });
  }

  initializeState() {
    this.getAttributeManager()!.addInstanced({
      instanceAnchor: {
        size: 3,
        type: 'float64',
        fp64: this.use64bitPositions(),
        accessor: (b: BarAttrs) => b.anchor
      },
      instanceTimes: {
        size: 4,
        accessor: (b: BarAttrs) => [b.from, b.to, b.endDay, b.completeDay]
      },
      instanceMeta: {
        size: 4,
        accessor: (b: BarAttrs) => [b.endKind, b.segCount, b.minZoom, 0]
      },
      instanceSegEntryA: { size: 4, accessor: (b: BarAttrs) => segs(b.segEntry, 0, 4) },
      instanceSegEntryB: { size: 2, accessor: (b: BarAttrs) => segs(b.segEntry, 4, 6) },
      instanceSegTypicalA: { size: 4, accessor: (b: BarAttrs) => segs(b.segTypicalDays, 0, 4) },
      instanceSegTypicalB: { size: 2, accessor: (b: BarAttrs) => segs(b.segTypicalDays, 4, 6) },
      instanceSegRowA: { size: 4, accessor: (b: BarAttrs) => segs(b.segRow, 0, 4) },
      instanceSegRowB: { size: 2, accessor: (b: BarAttrs) => segs(b.segRow, 4, 6) }
    });
  }

  updateState(params: UpdateParameters<this>) {
    super.updateState(params);
    const { props, oldProps, changeFlags } = params;
    if (changeFlags.extensionsChanged) {
      this.state.model?.destroy();
      this.state.model = this._getModel();
      this.getAttributeManager()!.invalidateAll();
    }
    if (props.chance !== oldProps.chance) this._uploadChance(props.chance);
  }

  finalizeState(context: Parameters<Layer['finalizeState']>[0]) {
    super.finalizeState(context);
    this.state.chanceTexture?.destroy();
  }

  draw() {
    const { model, chanceTexture } = this.state;
    if (!model || !chanceTexture) return;
    const { clock } = this.props;
    const stageBar: StageBarModuleProps = {
      day: clock.day,
      ...COLOURS[clock.theme],
      chanceTexture
    };
    model.shaderInputs.setProps({ stageBar });
    model.draw(this.context.renderPass);
  }

  /** One r8unorm texture per `chance` object; the previous one is destroyed. */
  private _uploadChance(chance: ChanceTexture) {
    this.state.chanceTexture?.destroy();
    const texture = this.context.device.createTexture({
      id: `${this.id}-chance`,
      format: 'r8unorm',
      width: chance.width,
      height: chance.height,
      sampler: { minFilter: 'nearest', magFilter: 'nearest' }
    });
    texture.writeData(chance.data);
    this.setState({ chanceTexture: texture });
  }

  private _getModel(): Model {
    // Triangle strip over the unit quad: (0,0) (1,0) (0,1) (1,1).
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
