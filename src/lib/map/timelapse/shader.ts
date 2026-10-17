// The `timelapse` shader module and the GLSL injections of TimelapseExtension (spec §4.2).
// `tl_evalPart` below is a rule-for-rule port of `evalPart` in state.ts: keep the rule order,
// the names and the straight-line shape identical, so a reviewer can diff the two.
import type { ShaderModule } from '@luma.gl/shadertools';
import { FLOOR_CAP } from './constants';

/** Uniforms of the `timelapse` module (§4.2.2). Tints are 0–1 RGB for the current theme. */
export type TimelapseModuleProps = {
  day: number;
  pass: number; // 0 solid, 1 ghost
  ghostAlpha: number;
  dyingHoldDays: number;
  dyingFadeDays: number;
  ftfM: number;
  tintPlanning: [number, number, number];
  tintPermit: [number, number, number];
  tintReady: [number, number, number];
  tintDying: [number, number, number];
};

/** A float literal GLSL accepts (always has a decimal point). */
const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// std140; field order matches `uniformTypes` (luma lays the block out from that order).
const uniformBlock = /* glsl */ `\
layout(std140) uniform timelapseUniforms {
  float day;
  float pass;
  float ghostAlpha;
  float dyingHoldDays;
  float dyingFadeDays;
  float ftfM;
  vec3 tintPlanning;
  vec3 tintPermit;
  vec3 tintReady;
  vec3 tintDying;
} timelapse;

// PartState codes, shared by both stages.
const float TL_HIDDEN = 0.0;
const float TL_PLANNING = 1.0;
const float TL_PERMIT = 2.0;
const float TL_READY = 3.0;
const float TL_CONSTRUCTING = 4.0;
const float TL_COMPLETE = 5.0;
const float TL_DYING = 6.0;
`;

export const timelapseModule = {
  name: 'timelapse',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    day: 'f32',
    pass: 'f32',
    ghostAlpha: 'f32',
    dyingHoldDays: 'f32',
    dyingFadeDays: 'f32',
    ftfM: 'f32',
    tintPlanning: 'vec3<f32>',
    tintPermit: 'vec3<f32>',
    tintReady: 'vec3<f32>',
    tintDying: 'vec3<f32>'
  }
} as const satisfies ShaderModule<TimelapseModuleProps>;

// Vertex declarations: the §4.2.1 attributes, the varyings, and the port of `evalPart`.
const vsDecl = /* glsl */ `
in vec4 tlA; // partFrom, partTo, ghostFrom, endDay
in vec4 tlB; // permitDay, readyDay, constructionDay, completeDay
in vec4 tlC; // endKind, constructionTypicalDays, stories, groundFtfM

out float tl_heightM;
flat out float tl_zCut;
flat out float tl_mode;
flat out float tl_fade;
out vec4 tl_ghost;

const float TL_FLOOR_CAP = ${glslFloat(FLOOR_CAP)};

struct TlPartAttrs {
  float partFrom;
  float partTo;
  float ghostFrom;
  float endDay;
  float permitDay;
  float readyDay;
  float constructionDay;
  float completeDay;
  float endKind;
  float constructionTypicalDays;
  float stories;
  float groundFtfM;
};

struct TlPartEval {
  float state;
  float alpha;
  float zCutM;
};

// Solid-floor cut height at time 'at': 0 until the first floor, else the top of floor n.
float tl_cutAt(TlPartAttrs a, float at) {
  float p = min((at - a.constructionDay) / a.constructionTypicalDays, TL_FLOOR_CAP);
  float n = floor(p * a.stories);
  return n == 0.0 ? 0.0 : a.groundFtfM + (n - 1.0) * timelapse.ftfM;
}

// The state, fade factor and solid/ghost cut height of one part on day t.
TlPartEval tl_evalPart(TlPartAttrs a, float t) {
  bool dying = a.endKind == 2.0 && t >= a.endDay;
  float age = t - a.endDay;
  // Footprint-only slots (stories 0) never take the solid states.
  bool solid = a.stories > 0.0;

  // 1. Hidden.
  if (t < a.ghostFrom || t < a.partFrom || t >= a.partTo) {
    return TlPartEval(TL_HIDDEN, 0.0, 0.0);
  }
  if (dying && age >= timelapse.dyingHoldDays + timelapse.dyingFadeDays) {
    return TlPartEval(TL_HIDDEN, 0.0, 0.0);
  }

  // 2. Dying: the construction cut freezes at the end day.
  if (dying) {
    float f = age < timelapse.dyingHoldDays
      ? 1.0
      : 1.0 - (age - timelapse.dyingHoldDays) / timelapse.dyingFadeDays;
    bool frozen = solid && a.constructionDay <= a.endDay;
    return TlPartEval(TL_DYING, f, frozen ? tl_cutAt(a, min(t, a.endDay)) : 0.0);
  }

  // 3. Complete. (The CPU's zCutM is OPEN_DAY, "no cut"; the fragment never reads it here.)
  if (solid && t >= a.completeDay) return TlPartEval(TL_COMPLETE, 1.0, 0.0);

  // 4. Constructing.
  if (solid && t >= a.constructionDay) {
    return TlPartEval(TL_CONSTRUCTING, 1.0, tl_cutAt(a, t));
  }

  // 5. Pre-construction ghost. A footprint-only slot keeps the ready tint once it constructs.
  bool ready = t >= a.readyDay || t >= a.constructionDay || t >= a.completeDay;
  if (ready) return TlPartEval(TL_READY, 1.0, 0.0);
  if (t >= a.permitDay) return TlPartEval(TL_PERMIT, 1.0, 0.0);
  return TlPartEval(TL_PLANNING, 1.0, 0.0);
}
`;

// End of the vertex main: evaluate the part, hide it, or pass the state and lit ghost colour on.
const vsMainEnd = /* glsl */ `
  TlPartEval tl_e = tl_evalPart(
    TlPartAttrs(tlA.x, tlA.y, tlA.z, tlA.w, tlB.x, tlB.y, tlB.z, tlB.w, tlC.x, tlC.y, tlC.z, tlC.w),
    timelapse.day
  );
#ifdef IS_SIDE_VERTEX
  tl_heightM = elevations * positions.y;
#else
  tl_heightM = elevations;
#endif
  tl_zCut = tl_e.zCutM;
  tl_mode = tl_e.state;
  tl_fade = tl_e.alpha;
  // Constructing and footprint-only parts show the ready tint above the cut.
  vec3 tl_tint = tl_e.state == TL_PLANNING ? timelapse.tintPlanning
    : tl_e.state == TL_PERMIT ? timelapse.tintPermit
    : tl_e.state == TL_DYING ? timelapse.tintDying
    : timelapse.tintReady;
  float tl_alpha = tl_e.state == TL_DYING
    ? 1.5 * timelapse.ghostAlpha * tl_e.alpha
    : timelapse.ghostAlpha;
  tl_ghost = vec4(
    lighting_getLightColor(tl_tint, project.cameraPosition, geometry.position.xyz, geometry.normal),
    tl_alpha
  );
  // Rule 1: a hidden part produces no fragments, so it is neither drawn nor picked.
  if (tl_e.state == TL_HIDDEN) {
    gl_Position = vec4(0.0);
  }
`;

const fsDecl = /* glsl */ `
in float tl_heightM;
flat in float tl_zCut;
flat in float tl_mode;
flat in float tl_fade;
in vec4 tl_ghost;
`;

// The §4.2.3 fragment table. 'color' arrives as the layer's lit palette colour (vColor).
const fsFilterColor = /* glsl */ `
  bool tl_ghostPass = timelapse.pass > 0.5;
  bool tl_below = tl_heightM < tl_zCut;
  if (tl_mode == TL_COMPLETE) {
    if (tl_ghostPass) discard;
  } else if (tl_mode == TL_CONSTRUCTING) {
    // Solid floors below the cut, the ready ghost above it.
    if (tl_ghostPass == tl_below) discard;
    if (tl_ghostPass) color = tl_ghost;
  } else if (tl_mode == TL_DYING) {
    if (!tl_ghostPass) discard;
    color = tl_below ? vec4(mix(color.rgb, timelapse.tintDying, 0.6), tl_fade) : tl_ghost;
  } else {
    // planning, permit, ready
    if (!tl_ghostPass) discard;
    color = tl_ghost;
  }
`;

/** Injections at the §4.0 hooks; the colour filter runs at default order (before picking). */
export const TIMELAPSE_INJECT = {
  'vs:#decl': vsDecl,
  'vs:#main-end': vsMainEnd,
  'fs:#decl': fsDecl,
  'fs:DECKGL_FILTER_COLOR': fsFilterColor
};
