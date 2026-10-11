import type { XY } from '../geometry';

export interface CoverCase {
  name: string;
  path: XY[];
  r: number;
  l: XY;
  covered: boolean;
}

// All values are exactly representable or chosen so the squared comparison is exact.
export const COVER_CASES: CoverCase[] = [
  {
    name: 'segment interior at exactly r',
    path: [
      [0, 0],
      [20, 0]
    ],
    r: 10,
    l: [10, 10],
    covered: true
  },
  {
    name: 'segment interior at r + 1e-6',
    path: [
      [0, 0],
      [20, 0]
    ],
    r: 10,
    l: [10, 10 + 1e-6],
    covered: false
  },
  {
    name: 'segment interior at r - 1e-6',
    path: [
      [0, 0],
      [20, 0]
    ],
    r: 10,
    l: [10, 10 - 1e-6],
    covered: true
  },
  {
    name: 'beyond B clamps to B, exactly r',
    path: [
      [0, 0],
      [20, 0]
    ],
    r: 10,
    l: [26, 8],
    covered: true
  },
  {
    name: 'beyond B clamps to B, r + 1e-6',
    path: [
      [0, 0],
      [20, 0]
    ],
    r: 10,
    l: [26, 8 + 1e-6],
    covered: false
  },
  {
    name: 'beyond A clamps to A, exactly r',
    path: [
      [0, 0],
      [20, 0]
    ],
    r: 10,
    l: [-6, -8],
    covered: true
  },
  {
    name: 'on endpoint A',
    path: [
      [0, 0],
      [20, 0]
    ],
    r: 5,
    l: [0, 0],
    covered: true
  },
  {
    name: 'on endpoint B',
    path: [
      [0, 0],
      [20, 0]
    ],
    r: 5,
    l: [20, 0],
    covered: true
  },
  { name: 'one-point path is a disc, exactly r', path: [[5, 5]], r: 5, l: [8, 9], covered: true },
  {
    name: 'one-point path is a disc, r + 1e-6',
    path: [[5, 5]],
    r: 5,
    l: [8, 9 + 1e-6],
    covered: false
  },
  {
    name: 'zero-length segment is a disc',
    path: [
      [5, 5],
      [5, 5]
    ],
    r: 5,
    l: [8, 9],
    covered: true
  },
  {
    name: 'beside a zero-length middle segment',
    path: [
      [0, 0],
      [0, 0],
      [10, 0]
    ],
    r: 1,
    l: [5, 1],
    covered: true
  },
  {
    name: 'far from every segment',
    path: [
      [0, 0],
      [10, 0],
      [10, 10]
    ],
    r: 1,
    l: [5, 5],
    covered: false
  }
];
