#!/bin/sh
# Regenerates src/lib/timelapse/fixtures/math-golden.json from the Sun fdlibm 5.3 C reference
# (netlib e_exp.c / e_log.c). Run from anywhere: sh scripts/math-golden/generate.sh
# Needs: cc, curl, shasum, npx (prettier). The netlib sources are fetched into a temp dir, checked
# against the pinned sha256 sums below (the script fails on any mismatch) and not kept.
# Set GOLDEN_SANITY=1 to also print how the reference compares with the platform libm.
#
# macOS: if cc cannot find the system libraries or headers (no Xcode, Command Line Tools only),
# point it at an SDK, e.g.
#   SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk sh scripts/math-golden/generate.sh
# (ls /Library/Developer/CommandLineTools/SDKs for the installed <sdk> names).
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

# Pin the reference sources: a changed upstream file must not silently change the golden.
cat > "$TMP/netlib.sha256" <<'SUMS'
04c96195b7ced914d659b5fd204724c182f091af8631fe42016ad6e27cb302ef  e_exp.c
a2b1bd1b367026a35f36da53425cd618386c3bf69d23ac224a40791aa9855ac9  e_log.c
64113c472c2676499288bc35a821b0867916552930bc52c7445d2c50dddf0e71  fdlibm.h
SUMS
(cd "$TMP" && shasum -a 256 -c netlib.sha256)

# shellcheck disable=SC2086
cc $CFLAGS "$ROOT/scripts/math-golden/driver.c" "$TMP/e_exp.c" "$TMP/e_log.c" -I"$TMP" \
  -o "$TMP/golden" -lm

"$TMP/golden" "netlib fdlibm 5.3 e_exp.c/e_log.c; cc $CFLAGS; scripts/math-golden/generate.sh" \
  > "$OUT"

# keep the committed JSON prettier-stable (npm run lint runs prettier --check)
(cd "$ROOT" && npx prettier --write "$OUT" > /dev/null)
echo "wrote $OUT"
