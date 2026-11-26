#!/bin/sh
# Run roofer v1.0.0 (macOS arm64 release binary) on each test set prepared by prep.py.
# The USGS SF 2023 cloud has no class 6: buildings are in class 1 (unclassified), so --bld-class 1.
# Usage: run_roofer.sh <work-dir> <roofer-dir> [set ...]
set -eu
WORK=$1
R=$2
shift 2
export PROJ_DATA="$R/share/proj" GDAL_DATA="$R/share/gdal"
for s in "$@"; do
  rm -rf "$WORK/$s/out"
  start=$(date +%s)
  "$R/bin/roofer" --bld-class 1 --id-attribute bid --srs EPSG:7131 --lod12 --lod13 --lod22 \
    -j "${JOBS:-8}" "$WORK/$s/pc" "$WORK/$s/footprints.gpkg" "$WORK/$s/out" \
    > "$WORK/$s/roofer.log" 2>&1
  end=$(date +%s)
  echo "$s wall_s=$((end - start))"
done
