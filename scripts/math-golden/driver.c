/*
 * Golden-vector driver for src/lib/timelapse/math.ts (stage-calibration spec 4.1a, section 6).
 * Calls the Sun fdlibm 5.3 reference (__ieee754_exp / __ieee754_log from netlib e_exp.c and
 * e_log.c) on a fixed input set and prints JSON: every value is a 16-hex-digit IEEE-754 bit
 * pattern. Built and run by generate.sh. Inputs come from bit patterns, exact literals and a
 * fixed 64-bit LCG, so the input set never depends on the platform libm.
 *
 * With GOLDEN_SANITY=1 in the environment it also compares the reference with the platform
 * exp/log on finite results (stderr only; the output JSON is unchanged).
 */
#include <float.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "fdlibm.h"

#define MAXN 512

static double ins[MAXN];
static int nin;

static uint64_t bitsOf(double x) {
  uint64_t u;
  memcpy(&u, &x, sizeof u);
  return u;
}

static double fromBits(uint64_t u) {
  double x;
  memcpy(&x, &u, sizeof x);
  return x;
}

static void add(double x) {
  if (nin >= MAXN) {
    fprintf(stderr, "too many inputs\n");
    exit(1);
  }
  ins[nin++] = x;
}

static void addBits(uint64_t u) { add(fromBits(u)); }

static void addPm(double x) {
  add(x);
  add(-x);
}

/* x, then the next double up in magnitude and the next down (exact bit arithmetic). */
static void addNeighbours(double x) {
  uint64_t u = bitsOf(x);
  add(x);
  add(fromBits(u + 1));
  add(fromBits(u - 1));
}

static uint64_t lcgState = 0x2545F4914F6CDD1DULL;

static uint64_t lcg(void) {
  lcgState = lcgState * 6364136223846793005ULL + 1442695040888963407ULL;
  return lcgState;
}

static const double LN2 = 0.693147180559945309417232121458;
static const double SQRT2 = 1.41421356237309504880168872421;

static void buildExp(void) {
  int k, i;
  nin = 0;
  add(0.0);
  add(-0.0);
  addBits(0x0000000000000001ULL);
  addBits(0x8000000000000001ULL);
  addBits(0x000FFFFFFFFFFFFFULL);
  addBits(0x800FFFFFFFFFFFFFULL);
  addPm(DBL_MIN);
  add(1.0);
  add(-1.0);
  for (k = -20; k <= 20; k++) add((double)k * LN2);
  addNeighbours(0.5 * LN2);
  addNeighbours(-0.5 * LN2);
  addNeighbours(1.5 * LN2);
  addNeighbours(-1.5 * LN2);
  add(7.09782712893383973096e+02);
  addBits(bitsOf(7.09782712893383973096e+02) + 1);
  add(-7.45133219101941108420e+02);
  /* next-down of the negative threshold is the next larger magnitude */
  addBits(bitsOf(-7.45133219101941108420e+02) + 1);
  add(-708.5);
  add(-740.0);
  add(-709.0);
  add(-720.0);
  add(-730.0);
  add(-745.0);
  add(709.0);
  add(709.7);
  {
    double t = 1.0 / 268435456.0; /* 2^-28, exact */
    addNeighbours(t);
    addNeighbours(-t);
  }
  for (i = 0; i <= 140; i++) add(-30.0 + 0.25 * (double)i);
  /* Inf and NaN come from bit patterns, so neither the INFINITY/NAN macros nor math.h are needed */
  addBits(0x7FF0000000000000ULL);
  addBits(0xFFF0000000000000ULL);
  addBits(0x7FF8000000000000ULL);
  addBits(0xFFF8000000000000ULL);
  for (i = 0; i < 40; i++) {
    double u = (double)(lcg() >> 11) / 9007199254740992.0;
    add(-745.0 + u * 1455.0);
  }
}

static void buildLog(void) {
  int k, i;
  double rho, ratio;
  nin = 0;
  add(0.0);
  add(-0.0);
  addBits(0x0000000000000001ULL);
  addBits(0x000FFFFFFFFFFFFFULL);
  add(DBL_MIN);
  add(DBL_MAX);
  add(1.0);
  for (k = 1; k <= 52; k += 3) {
    double d = ldexp(1.0, -k);
    add(1.0 + d);
    add(1.0 - d);
  }
  addNeighbours(SQRT2 / 2.0);
  addNeighbours(SQRT2);
  /* ldexp(1, k) is exact, including the subnormal powers */
  for (k = -1074; k <= 1023; k += 64) add(ldexp(1.0, k));
  rho = 1e-6;
  ratio = 1.3999980668948688; /* (0.5 / 1e-6)^(1/39), as a literal */
  for (i = 0; i < 40; i++) {
    double r = (i == 39) ? 0.5 : rho;
    add(1.0 - r);
    rho *= ratio;
  }
  for (k = 2; k <= 20; k++) add((double)k);
  add(0.5);
  add(0.1);
  add(0.9);
  add(1e-300);
  add(1e300);
  add(-1.0);
  addBits(0xFFF0000000000000ULL);
  addBits(0x7FF0000000000000ULL);
  addBits(0x7FF8000000000000ULL);
  for (i = 0; i < 40;) {
    uint64_t u = lcg() & 0x7FFFFFFFFFFFFFFFULL;
    if (u == 0 || (u >> 52) == 0x7FF) continue;
    addBits(u);
    i++;
  }
}

static int isNan(double x) { return x != x; }

/* Distance in units in the last place between two finite doubles. */
static int64_t ulpDist(double a, double b) {
  int64_t ia = (int64_t)bitsOf(a);
  int64_t ib = (int64_t)bitsOf(b);
  if (ia < 0) ia = INT64_MIN - ia;
  if (ib < 0) ib = INT64_MIN - ib;
  return ia > ib ? ia - ib : ib - ia;
}

static void emit(const char *name, double (*ref)(double), double (*plat)(double), int last) {
  int i, differ = 0, finite = 0;
  int64_t maxUlp = 0;
  int sanity = getenv("GOLDEN_SANITY") != NULL;
  printf("  \"%s\": [\n", name);
  for (i = 0; i < nin; i++) {
    double y = ref(ins[i]);
    printf("    [\"%016llx\", \"%016llx\"]%s\n", (unsigned long long)bitsOf(ins[i]),
           (unsigned long long)bitsOf(y), i + 1 < nin ? "," : "");
    if (sanity) {
      double p = plat(ins[i]);
      if (!isNan(y) && !isNan(p) && y - y == 0.0 && p - p == 0.0) {
        int64_t d = ulpDist(y, p);
        finite++;
        if (d != 0) differ++;
        if (d > maxUlp) maxUlp = d;
      }
    }
  }
  printf("  ]%s\n", last ? "" : ",");
  if (sanity)
    fprintf(stderr,
            "sanity %s: %d inputs, %d finite results, %d differ from platform, max %lld ulp\n",
            name, nin, finite, differ, (long long)maxUlp);
}

static double platExp(double x) { return __builtin_exp(x); }
static double platLog(double x) { return __builtin_log(x); }

int main(int argc, char **argv) {
  const char *source = argc > 1 ? argv[1] : "netlib fdlibm 5.3";
  printf("{\n  \"source\": \"%s\",\n", source);
  buildExp();
  emit("exp", __ieee754_exp, platExp, 0);
  buildLog();
  emit("log", __ieee754_log, platLog, 1);
  printf("}\n");
  return 0;
}
