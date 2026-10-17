/**
 * Deterministic `exp` and `log` for the FZP timelapse (stage-calibration spec 4.1a).
 *
 * Line-for-line TypeScript ports of Sun fdlibm 5.3 `__ieee754_exp` (e_exp.c) and
 * `__ieee754_log` (e_log.c). They use only IEEE-754 `+ - * /` and integer bit operations
 * (JS never fuses multiply-add), so every JS engine returns the same bits. Code on a
 * determinism path must call these, never the built-in exp, log or pow on Math (an ESLint rule
 * enforces it). The expected bit patterns live in `fixtures/math-golden.json`, produced by the
 * C reference through `scripts/math-golden/generate.sh`.
 *
 * Original notices, preserved as the licence requires:
 *
 * e_exp.c
 * ====================================================
 * Copyright (C) 2004 by Sun Microsystems, Inc. All rights reserved.
 *
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 *
 * e_log.c
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 *
 * Special cases (as fdlibm): exp(+Infinity) = Infinity, exp(-Infinity) = 0, overflow gives
 * Infinity, underflow gives 0, NaN propagates; log(0) = -Infinity, log(x < 0) = NaN,
 * log(+Infinity) = Infinity.
 */

// One scratch word pair. DataView defaults to big-endian, so offset 0 is the high word and
// offset 4 the low word whatever the host byte order.
const buf = new DataView(new ArrayBuffer(8));

/** High 32 bits of x as a signed int (C `__HI(x)`). */
function getHi(x: number): number {
  buf.setFloat64(0, x);
  return buf.getInt32(0);
}

/** Low 32 bits of x as an unsigned int (C `__LO(x)`). */
function getLo(x: number): number {
  buf.setFloat64(0, x);
  return buf.getUint32(4);
}

/** x with its high word replaced by h and its low word kept (C `__HI(x) = h`). */
function setHi(x: number, h: number): number {
  buf.setFloat64(0, x);
  buf.setInt32(0, h);
  return buf.getFloat64(0);
}

// ---- e_exp.c constants ----
const one = 1.0;
const halF = [0.5, -0.5];
const huge = 1.0e300;
const twom1000 = 9.3326361850321887899e-302; /* 2**-1000=0x01700000,0*/
const o_threshold = 7.09782712893383973096e2; /* 0x40862E42, 0xFEFA39EF */
const u_threshold = -7.4513321910194110842e2; /* 0xc0874910, 0xD52D3051 */
const ln2HI = [
  6.9314718036912381649e-1 /* 0x3fe62e42, 0xfee00000 */,
  -6.9314718036912381649e-1 /* 0xbfe62e42, 0xfee00000 */
];
const ln2LO = [
  1.90821492927058770002e-10 /* 0x3dea39ef, 0x35793c76 */,
  -1.90821492927058770002e-10 /* 0xbdea39ef, 0x35793c76 */
];
const invln2 = 1.442695040888963387; /* 0x3ff71547, 0x652b82fe */
const P1 = 1.66666666666666019037e-1; /* 0x3FC55555, 0x5555553E */
const P2 = -2.77777777770155933842e-3; /* 0xBF66C16C, 0x16BEBD93 */
const P3 = 6.61375632143793436117e-5; /* 0x3F11566A, 0xAF25DE2C */
const P4 = -1.6533902205465251539e-6; /* 0xBEBBBD41, 0xC5D26BF1 */
const P5 = 4.13813679705723846039e-8; /* 0x3E663769, 0x72BEA4D0 */

/** e^x, bit-identical to fdlibm 5.3 `__ieee754_exp`. */
export function exp(x: number): number {
  let y: number;
  let hi = 0;
  let lo = 0;
  let t: number;
  let k = 0;

  const hx0 = getHi(x); /* high word of x */
  const xsb = (hx0 >>> 31) & 1; /* sign bit of x */
  const hx = hx0 & 0x7fffffff; /* high word of |x| */

  /* filter out non-finite argument */
  if (hx >= 0x40862e42) {
    /* if |x|>=709.78... */
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | getLo(x)) !== 0) return x + x; /* NaN */
      else return xsb === 0 ? x : 0.0; /* exp(+-inf)={inf,0} */
    }
    if (x > o_threshold) return huge * huge; /* overflow */
    if (x < u_threshold) return twom1000 * twom1000; /* underflow */
  }

  /* argument reduction */
  if (hx > 0x3fd62e42) {
    /* if  |x| > 0.5 ln2 */
    if (hx < 0x3ff0a2b2) {
      /* and |x| < 1.5 ln2 */
      hi = x - ln2HI[xsb];
      lo = ln2LO[xsb];
      k = 1 - xsb - xsb;
    } else {
      k = (invln2 * x + halF[xsb]) | 0; /* C (int) cast truncates toward zero */
      t = k;
      hi = x - t * ln2HI[0]; /* t*ln2HI is exact here */
      lo = t * ln2LO[0];
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    /* when |x|<2**-28 */
    if (huge + x > one) return one + x; /* trigger inexact */
  } else k = 0;

  /* x is now in primary range */
  t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return one - ((x * c) / (c - 2.0) - x);
  else y = one - (lo - (x * c) / (2.0 - c) - hi);
  if (k >= -1021) {
    y = setHi(y, (getHi(y) + (k << 20)) | 0); /* add k to y's exponent */
    return y;
  } else {
    y = setHi(y, (getHi(y) + ((k + 1000) << 20)) | 0); /* add k to y's exponent */
    return y * twom1000;
  }
}

// ---- e_log.c constants ----
const ln2_hi = 6.9314718036912381649e-1; /* 3fe62e42 fee00000 */
const ln2_lo = 1.90821492927058770002e-10; /* 3dea39ef 35793c76 */
const two54 = 1.8014398509481984e16; /* 43500000 00000000 */
const Lg1 = 6.66666666666673513e-1; /* 3FE55555 55555593 */
const Lg2 = 3.999999999940941908e-1; /* 3FD99999 9997FA04 */
const Lg3 = 2.857142874366239149e-1; /* 3FD24924 94229359 */
const Lg4 = 2.222219843214978396e-1; /* 3FCC71C5 1D8E78AF */
const Lg5 = 1.818357216161805012e-1; /* 3FC74664 96CB03DE */
const Lg6 = 1.531383769920937332e-1; /* 3FC39A09 D078C69F */
const Lg7 = 1.479819860511658591e-1; /* 3FC2F112 DF3E5244 */

const zero = 0.0;

/** Natural logarithm, bit-identical to fdlibm 5.3 `__ieee754_log`. */
export function log(x: number): number {
  let hfsq: number;
  let R: number;
  let dk: number;
  let k: number;
  let hx: number;
  let i: number;

  hx = getHi(x); /* high word of x (signed) */
  const lx = getLo(x); /* low  word of x */

  k = 0;
  if (hx < 0x00100000) {
    /* x < 2**-1022  */
    if (((hx & 0x7fffffff) | lx) === 0) return -two54 / zero; /* log(+-0)=-inf */
    if (hx < 0) return (x - x) / zero; /* log(-#) = NaN */
    k -= 54;
    x *= two54; /* subnormal number, scale up x */
    hx = getHi(x); /* high word of x */
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  i = (hx + 0x95f64) & 0x100000;
  x = setHi(x, hx | (i ^ 0x3ff00000)); /* normalize x or x/2 */
  k += i >> 20;
  const f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    /* |f| < 2**-20 */
    if (f === zero) {
      if (k === 0) return zero;
      else {
        dk = k;
        return dk * ln2_hi + dk * ln2_lo;
      }
    }
    R = f * f * (0.5 - 0.3333333333333333 * f); // C: 0.33333333333333333 (same double; no-loss-of-precision)
    if (k === 0) return f - R;
    else {
      dk = k;
      return dk * ln2_hi - (R - dk * ln2_lo - f);
    }
  }
  const s = f / (2.0 + f);
  dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  R = t2 + t1;
  if (i > 0) {
    hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    else return dk * ln2_hi - (hfsq - (s * (hfsq + R) + dk * ln2_lo) - f);
  } else {
    if (k === 0) return f - s * (f - R);
    else return dk * ln2_hi - (s * (f - R) - dk * ln2_lo - f);
  }
}
