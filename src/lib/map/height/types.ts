/**
 * Wire types for the height-limit lids and contours (worker to page). Types and constants only,
 * so the scenario worker and the page can both import this without pulling in a DOM.
 */

/** Chain kinds: a limit step between two regions, or a boundary where the winning source changes. */
export const CHAIN_LIMIT = 0;
export const CHAIN_SOURCE = 1;
/** A label with this minZoom never shows. */
export const NO_ZOOM = 255;

export interface LabelSet {
  text: string[];
  /** lng, lat, zM per label. */
  position: Float64Array;
  minZoom: Uint8Array;
}

/** City-wide contour polylines, flat on the ground. Chain i spans starts[i]..starts[i + 1]. */
export interface ChainSet {
  starts: Uint32Array;
  /** lng, lat per vertex. */
  positions: Float64Array;
  /** Stories on the higher and lower side. */
  hi: Uint8Array;
  lo: Uint8Array;
  kind: Uint8Array;
  /** Indices into HeightCity.sourceIds for the source on each side. */
  srcA: Uint16Array;
  srcB: Uint16Array;
}

export interface HeightCity {
  rev: number;
  sourceIds: string[];
  chains: ChainSet;
  labels: LabelSet;
}

export interface LidPieces {
  stories: Uint8Array;
  source: Uint16Array;
  component: Uint32Array;
  glaze: Uint8Array;
}

/** lng,lat pairs; rings[0] is the outer ring (CCW), the rest are holes. */
export interface LidFace {
  piece: number;
  rings: Float64Array[];
}

export interface LidRims {
  starts: Uint32Array;
  /** lng, lat, zM. */
  positions: Float64Array;
  piece: Uint32Array;
  kind: Uint8Array;
}

export interface LidWalls {
  count: number;
  /** lng, lat of each wall's two ends. */
  a: Float64Array;
  b: Float64Array;
  zLo: Float32Array;
  zHi: Float32Array;
  /** The higher side. */
  piece: Uint32Array;
}

export interface HeightLids {
  limitsRev: number;
  /** The source ids the pieces' `source` codes index into, copied from the limits this lid was built from. */
  sourceIds: string[];
  pieces: LidPieces;
  faces: LidFace[];
  rims: LidRims;
  walls: LidWalls;
  labels: LabelSet;
}
