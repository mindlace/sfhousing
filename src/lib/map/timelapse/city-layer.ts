// CityLayer (map-citywide slice 6): one instanced screen-space quad per merged city record. The
// vertex shader evaluates the record on `clock.day` at the map's zoom and camera
// (`cy_evalCity`, a rule-for-rule port of `evalCity` and `edgeOf` in city.ts: keep the rule
// order identical) and either draws a merged ring at the anchor (in view, below the handover
// zoom), an edge glow at the view's edge toward it (off view), or nothing. The fragment shader
// strokes the ring 2 px wide, or fills the glow's disc (half of it falls off the canvas), in the
// kind's halo tone; a policy record is in the accent and doubled (a second stroke inside the
// ring, a land rim inside the glow). Modelled on HaloLayer: `draw` reads the shared clock, so
// `setTime` sets no prop, and nothing here runs per record in JS per frame or per map move.
import {
  Layer,
  project32,
  type WebMercatorViewport,
  type DefaultProps,
  type LayerProps,
  type UpdateParameters
} from '@deck.gl/core';
import { Geometry, Model } from '@luma.gl/engine';
import type { ShaderModule } from '@luma.gl/shadertools';
import {
  CITY_CELL_M,
  CITY_EDGE_DAYS,
  CITY_GLOW_FAR_ALPHA,
  CITY_GLOW_REACH,
  CITY_HANDOVER_ZOOM,
  CITY_POLICY_INSET_PX,
  CITY_R_MAX_PX,
  CITY_R_REF_HOMES,
  CITY_RING_DAYS,
  CITY_RING_FADE_PX,
  CITY_RING_FLOOR_PX,
  HALO_R_PX
} from './constants';
import { CITY_EDGE_MARGIN_PX, CITY_KIND, M_PER_DEG, cityForward, type CityAttrs } from './city';
import { HALO_COLOURS, type HaloColours } from './halo-layer';
import type { TimelineClock } from './types';

/** Uniforms of the `city` module. Colours are 0–1 sRGB, from the halo layer's table. */
export type CityModuleProps = HaloColours & {
  day: number;
  reduced: number; // 1 under reduced motion, else 0
  /** 2^CITY_HANDOVER_ZOOM: zoom >= the handover is project.scale >= it, exact at 14.0. */
  handoverScale: number;
  /** CSS px per metre at the view's centre on the ground. */
  pxPerMeter: number;
  /** The view's ground half-diagonal in metres (halfDiagM). */
  halfDiagM: number;
  /** The view's centre: lng, lat. */
  centre: [number, number];
  /** The view's CSS px size. */
  viewPx: [number, number];
  /** The glows' inset rectangle: top, right, bottom, left in CSS px. */
  inset: [number, number, number, number];
  /** One square up the screen on the ground, in degrees (cityForward). */
  forward: [number, number];
};

/** A float literal GLSL accepts (always has a decimal point). */
const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// std140; field order matches `uniformTypes` (luma lays the block out from that order).
const uniformBlock = /* glsl */ `\
layout(std140) uniform cityUniforms {
  float day;
  float reduced;
  float handoverScale;
  float pxPerMeter;
  float halfDiagM;
  vec2 centre;
  vec2 viewPx;
  vec2 forward;
  vec4 inset;
  vec3 approved;
  vec3 started;
  vec3 complete;
  vec3 policy;
  vec3 land;
} city;
`;

const cityModule = {
  name: 'city',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    day: 'f32',
    reduced: 'f32',
    handoverScale: 'f32',
    pxPerMeter: 'f32',
    halfDiagM: 'f32',
    centre: 'vec2<f32>',
    viewPx: 'vec2<f32>',
    forward: 'vec2<f32>',
    inset: 'vec4<f32>',
    approved: 'vec3<f32>',
    started: 'vec3<f32>',
    complete: 'vec3<f32>',
    policy: 'vec3<f32>',
    land: 'vec3<f32>'
  }
} as const satisfies ShaderModule<CityModuleProps>;

/** Half the ring's stroke, in px. */
const STROKE_HALF_PX = 1;
/** CityEval.mode as a float. */
const MODE = { none: 0, ring: 1, edge: 2 } as const;

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME city-layer-vertex-shader

in vec2 positions; // quad corner: -1 → 1 on each axis
in vec3 instanceAnchor;
in vec3 instanceAnchor64Low;
in vec3 instanceCity; // day, homes, kind

out vec2 vPx;
flat out float vMode;
flat out float vRadius;
flat out float vPolicy;
flat out vec4 vColor;

const float CY_EDGE_DAYS = ${glslFloat(CITY_EDGE_DAYS)};
const float CY_RING_DAYS = ${glslFloat(CITY_RING_DAYS)};
const vec2 CY_HALO_R_PX = vec2(${glslFloat(HALO_R_PX[0])}, ${glslFloat(HALO_R_PX[1])});
const float CY_R_MAX_PX = ${glslFloat(CITY_R_MAX_PX)};
const float CY_R_REF_HOMES = ${glslFloat(CITY_R_REF_HOMES)};
const float CY_POLICY = ${glslFloat(CITY_KIND.policy)};
const float CY_NONE = ${glslFloat(MODE.none)};
const float CY_RING = ${glslFloat(MODE.ring)};
const float CY_EDGE = ${glslFloat(MODE.edge)};
const float CY_STROKE_HALF_PX = ${glslFloat(STROKE_HALF_PX)};
const float CY_EDGE_MARGIN_PX = ${glslFloat(CITY_EDGE_MARGIN_PX)};
const float CY_CELL_M = ${glslFloat(CITY_CELL_M)};
const float CY_M_PER_DEG = ${glslFloat(M_PER_DEG)};
const float CY_GLOW_REACH = ${glslFloat(CITY_GLOW_REACH)};
const float CY_GLOW_FAR_ALPHA = ${glslFloat(CITY_GLOW_FAR_ALPHA)};
const float CY_RING_FLOOR_PX = ${glslFloat(CITY_RING_FLOOR_PX)};
const float CY_RING_FADE_PX = ${glslFloat(CITY_RING_FADE_PX)};

// evalCity's CityEval.
struct CyEval {
  float mode;
  float sizePx;
  float alpha;
  vec2 at;
};

// cityRadiusPx.
float cy_radiusPx(float homes) {
  return min(CY_R_MAX_PX, CY_HALO_R_PX.y * max(1.0, sqrt(homes / CY_R_REF_HOMES)));
}

// Port of inView: c in the view widened by m (NDC) on each side.
bool cy_inView(vec3 c, vec2 m) {
  return c.z > 0.0 && abs(c.x / c.z) <= 1.0 + m.x && abs(c.y / c.z) <= 1.0 + m.y;
}

// Port of edgeOf: false in view; else true and 'at' the NDC point on the view's edge toward c.
// Behind the camera (w <= 0) the direction is (x, y), not divided and not negated.
bool cy_edgeOf(vec3 c, out vec2 at) {
  at = vec2(0.0);
  if (cy_inView(c, vec2(0.0))) return false;
  vec2 d = c.z > 0.0 ? c.xy / c.z : c.xy;
  float m = max(abs(d.x), abs(d.y));
  at = m == 0.0 ? vec2(0.0, -1.0) : d / m;
  return true;
}

// Port of squareHalfPx with fwd; focalW is project.focalDistance, the clip w of the view's
// centre.
float cy_squareHalfPx(vec3 clip, vec3 fwd) {
  if (clip.z <= 0.0) return 0.0;
  float across = CY_CELL_M * city.pxPerMeter * project.focalDistance / clip.z;
  if (fwd.z <= 0.0) return 0.0;
  vec2 d = (fwd.xy / fwd.z - clip.xy / clip.z) * city.viewPx / 2.0;
  return min(across, length(d)) / 2.0;
}

// Port of groundM(a, city.centre).
float cy_groundM(vec2 a) {
  vec2 b = city.centre;
  return length(vec2((a.x - b.x) * CY_M_PER_DEG * cos(radians(b.y)), (a.y - b.y) * CY_M_PER_DEG));
}

// Port of insetEdge.
vec2 cy_insetEdge(vec2 e) {
  float x0 = -1.0 + 2.0 * city.inset.w / city.viewPx.x;
  float x1 = 1.0 - 2.0 * city.inset.y / city.viewPx.x;
  float y0 = -1.0 + 2.0 * city.inset.z / city.viewPx.y;
  float y1 = 1.0 - 2.0 * city.inset.x / city.viewPx.y;
  return vec2((x0 + x1) / 2.0 + e.x * (x1 - x0) / 2.0, (y0 + y1) / 2.0 + e.y * (y1 - y0) / 2.0);
}

// The record on day t. Port of evalCity; 'far' is zoom >= CITY_HANDOVER_ZOOM.
CyEval cy_evalCity(
  float day, float homes, vec2 anchor, float t, bool far, vec3 clip, bool reduced, vec3 fwd
) {
  CyEval none = CyEval(CY_NONE, 0.0, 0.0, vec2(0.0));
  // 1. Nothing before its day (the last event it holds).
  if (t < day) return none;
  float age = t - day;
  vec2 edge;
  // 2. Off view: an edge glow toward it.
  if (cy_edgeOf(clip, edge)) {
    // a. From the handover, a project ringing within reach of the view shows on its own.
    vec2 margin = 2.0 * CY_EDGE_MARGIN_PX / city.viewPx;
    if (far && cy_inView(clip, margin)) return none;
    // b. Only what is near enough to matter here.
    float range = cy_groundM(anchor) / city.halfDiagM;
    if (range > CY_GLOW_REACH) return none;
    // c. The glow's window, fainter with distance.
    if (age >= CY_EDGE_DAYS) return none;
    float strength = 1.0 - (1.0 - CY_GLOW_FAR_ALPHA) * range / CY_GLOW_REACH;
    return CyEval(
      CY_EDGE,
      cy_radiusPx(homes) / 2.0,
      (reduced ? 1.0 : 1.0 - age / CY_EDGE_DAYS) * strength,
      cy_insetEdge(edge)
    );
  }
  // 3. From the handover each project rings on its own.
  if (far) return none;
  // 4. Near the horizon a square is too small to ring.
  float halfSq = cy_squareHalfPx(clip, fwd);
  if (halfSq <= CY_RING_FADE_PX) return none;
  // 5. A merged ring, no wider than its square, grows and fades over its life.
  if (age >= CY_RING_DAYS) return none;
  vec2 at = clip.xy / clip.z;
  float fade = min(1.0, (halfSq - CY_RING_FADE_PX) / (CY_RING_FLOOR_PX - CY_RING_FADE_PX));
  float r = max(CY_RING_FLOOR_PX, min(cy_radiusPx(homes), halfSq));
  if (reduced) return CyEval(CY_RING, r, fade, at);
  float u = age / CY_RING_DAYS;
  float r0 = min(CY_HALO_R_PX.x, r);
  return CyEval(CY_RING, r0 + (r - r0) * u, (1.0 - u) * fade, at);
}

// The kind's tone: the three stage tones, or the accent for the person's policy.
vec3 cy_color(float kind) {
  if (kind == CY_POLICY) return city.policy;
  if (kind == 0.0) return city.approved;
  if (kind == 1.0) return city.started;
  return city.complete;
}

void main(void) {
  float kind = instanceCity.z;
  vec4 anchorCommon;
  vec4 anchor = project_position_to_clipspace(
    instanceAnchor, instanceAnchor64Low, vec3(0.0), anchorCommon
  );
  geometry.position = anchorCommon;
  // One square up the screen from the anchor: the square's foreshortened depth.
  vec3 fwd = project_position_to_clipspace(
    vec3(instanceAnchor.xy + city.forward, 0.0), instanceAnchor64Low, vec3(0.0)
  ).xyw;
  CyEval e = cy_evalCity(
    instanceCity.x, instanceCity.y, instanceAnchor.xy, city.day,
    project.scale >= city.handoverScale, anchor.xyw, city.reduced > 0.5, fwd
  );
  // Half the quad: the ring's outer edge or the disc's radius, plus a pixel of margin.
  float halfPx = e.sizePx + (e.mode == CY_RING ? CY_STROKE_HALF_PX : 0.0) + 1.0;
  vec2 offsetPx = positions * halfPx;
  // In NDC at w = 1, so the ring and the glow keep their px size at any distance; z 0 (no depth
  // test) so a far anchor is never clipped by the far plane once evalCity draws it.
  gl_Position = vec4(e.at, 0.0, 1.0);
  gl_Position.xy += project_pixel_size_to_clipspace(offsetPx) / project.focalDistance;

  vPx = offsetPx;
  vMode = e.mode;
  vRadius = e.sizePx;
  vPolicy = kind == CY_POLICY ? 1.0 : 0.0;
  vColor = vec4(cy_color(kind), e.alpha * layer.opacity);
  // Mode none: no fragments.
  if (e.mode == CY_NONE) {
    gl_Position = vec4(0.0);
  }
}
`;

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME city-layer-fragment-shader

precision highp float;

in vec2 vPx;
flat in float vMode;
flat in float vRadius;
flat in float vPolicy;
flat in vec4 vColor;

out vec4 fragColor;

const float CY_EDGE = ${glslFloat(MODE.edge)};
const float CY_STROKE_HALF_PX = ${glslFloat(STROKE_HALF_PX)};
const float CY_INSET_PX = ${glslFloat(CITY_POLICY_INSET_PX)};

void main(void) {
  float d = length(vPx);
  if (vMode == CY_EDGE) {
    // A filled disc centred on the edge point. A policy glow's second cue: a 1 px land rim
    // ending CY_INSET_PX inside the disc's edge.
    if (d > vRadius) discard;
    float rim = vRadius - CY_INSET_PX;
    bool onRim = vPolicy > 0.5 && d > rim - 1.0 && d <= rim;
    fragColor = vec4(onRim ? city.land : vColor.rgb, vColor.a);
    return;
  }
  // A ring: a 2 px stroke centred on the radius; a policy ring's second cue: another stroke
  // CY_INSET_PX inside it (once there is room).
  float inner = vRadius - CY_INSET_PX;
  bool onOuter = abs(d - vRadius) <= CY_STROKE_HALF_PX;
  bool onInner = vPolicy > 0.5 && inner >= CY_STROKE_HALF_PX && abs(d - inner) <= CY_STROKE_HALF_PX;
  if (!onOuter && !onInner) discard;
  fragColor = vColor;
}
`;

/** Props added by CityLayer. */
type _CityLayerProps = {
  data: CityAttrs[];
  /** Shared clock, mutated in place by `setTime`; `draw` reads `day` and `theme`. */
  clock: TimelineClock;
  /** Reduced motion: still rings at their full radius and still glows, at full strength. */
  reduced: boolean;
  /**
   * The glows' inset from the map's edges, [top, right, bottom, left] in CSS px. Shared and
   * mutated in place by the controller (`setEdgeInset`); `draw` reads it, so a change sets no
   * prop.
   */
  edgeInset: [number, number, number, number];
};

export type CityLayerProps = _CityLayerProps & LayerProps;

const defaultProps: DefaultProps<CityLayerProps> = {
  // Identity compares: the same clock mutated in place is not a change.
  clock: { type: 'object', value: null as unknown as TimelineClock },
  reduced: false,
  edgeInset: { type: 'object', value: [0, 0, 0, 0] }
};

/** Fixed props: one city layer per map, never picked, drawn over everything without depth. */
const FIXED = {
  id: 'timeline-city',
  pickable: false,
  parameters: { depthWriteEnabled: false, depthCompare: 'always' }
} as const satisfies Partial<LayerProps>;

const HANDOVER_SCALE = 2 ** CITY_HANDOVER_ZOOM;

export class CityLayer extends Layer<_CityLayerProps> {
  static layerName = 'CityLayer';
  static defaultProps = defaultProps;

  declare state: {
    model?: Model;
    /** The one `city` props object `draw` mutates in place (no per-draw allocation). */
    uniforms?: { city: CityModuleProps };
  };

  constructor(...propObjects: Partial<CityLayerProps>[]) {
    super(...propObjects, FIXED);
  }

  getShaders() {
    return super.getShaders({ vs, fs, modules: [project32, cityModule] });
  }

  initializeState() {
    this.getAttributeManager()!.addInstanced({
      instanceAnchor: {
        size: 3,
        type: 'float64',
        fp64: this.use64bitPositions(),
        accessor: (c: CityAttrs) => [c.anchor[0], c.anchor[1], 0]
      },
      instanceCity: {
        size: 3,
        accessor: (c: CityAttrs) => [c.day, c.homes, c.kind]
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
    const { clock, reduced, edgeInset } = this.props;
    // luma copies the values, so one object per layer, mutated in place, serves every draw.
    const u = (this.state.uniforms ??= {
      city: {
        day: 0,
        reduced: 0,
        handoverScale: HANDOVER_SCALE,
        pxPerMeter: 1,
        halfDiagM: 1,
        centre: [0, 0],
        viewPx: [1, 1],
        forward: [0, 0],
        inset: [0, 0, 0, 0],
        ...HALO_COLOURS.light
      }
    });
    const c = u.city;
    const t = HALO_COLOURS[clock.theme];
    c.day = clock.day;
    c.reduced = reduced ? 1 : 0;
    // The camera, O(1) per draw: the centre's scale and the view's size and inset.
    const vp = this.context.viewport as WebMercatorViewport;
    c.pxPerMeter = vp.scale * vp.distanceScales.unitsPerMeter[0];
    c.viewPx[0] = vp.width;
    c.viewPx[1] = vp.height;
    c.halfDiagM = Math.hypot(vp.width, vp.height) / 2 / c.pxPerMeter;
    c.centre[0] = vp.longitude;
    c.centre[1] = vp.latitude;
    const f = cityForward(vp.bearing, vp.latitude);
    c.forward[0] = f[0];
    c.forward[1] = f[1];
    for (let i = 0; i < 4; i++) c.inset[i] = edgeInset[i];
    c.approved = t.approved;
    c.started = t.started;
    c.complete = t.complete;
    c.policy = t.policy;
    c.land = t.land;
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
