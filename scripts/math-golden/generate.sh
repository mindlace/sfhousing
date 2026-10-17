#!/bin/sh
# Regenerates src/lib/timelapse/fixtures/math-golden.json from the Sun fdlibm 5.3 C reference
# (netlib e_exp.c / e_log.c). Run from anywhere: sh scripts/math-golden/generate.sh
# Needs: cc, curl, npx (prettier). The netlib sources are fetched into a temp dir and not kept.
# Set GOLDEN_SANITY=1 to also print how the reference compares with the platform libm.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/src/lib/timelapse/fixtures/math-golden.json"
BASE=https://www.netlib.org/fdlibm
CFLAGS="-O0 -ffp-contract=off -fno-strict-aliasing -D__LITTLE_ENDIAN"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$(dirname "$OUT")"

for f in e_exp.c e_log.c fdlibm.h; do
  curl -sSfL -o "$TMP/$f" "$BASE/$f"
done

# shellcheck disable=SC2086
cc $CFLAGS "$ROOT/scripts/math-golden/driver.c" "$TMP/e_exp.c" "$TMP/e_log.c" -I"$TMP" \
  -o "$TMP/golden"

"$TMP/golden" "netlib fdlibm 5.3 e_exp.c/e_log.c; cc $CFLAGS; scripts/math-golden/generate.sh" \
  > "$OUT"

# keep the committed JSON prettier-stable (npm run lint runs prettier --check)
(cd "$ROOT" && npx prettier --write "$OUT" > /dev/null)
echo "wrote $OUT"
