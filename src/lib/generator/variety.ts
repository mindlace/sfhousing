import { mulberry32 } from './seed';

export interface VarietyDraws {
  edgeInsetM: number;
  stepbackM: number;
  parapetM: number;
  towerSlide: number /* -1..1 */;
  towerAspect: number /* 1..1.5 */;
  aduEnd: 1 | -1;
}

/** Maps six uniforms in [0,1) to draws, in the frozen order (§4.2). */
export function varietyFromUniforms(r: readonly number[]): VarietyDraws {
  return {
    edgeInsetM: 0.2 + 0.4 * r[0],
    stepbackM: 1.5 + 1.5 * r[1],
    parapetM: 0.3 + 0.9 * r[2],
    towerSlide: 2 * r[3] - 1,
    towerAspect: 1 + 0.5 * r[4],
    aduEnd: r[5] < 0.5 ? 1 : -1
  };
}

/** Always exactly six draws, whatever the typology, so the stream never shifts. */
export function drawVariety(seed: number): VarietyDraws {
  const r = mulberry32(seed);
  return varietyFromUniforms([r(), r(), r(), r(), r(), r()]);
}
