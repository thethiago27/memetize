#!/usr/bin/env bash
#
# Generates a short MP4 (~8s) with three hard cuts (red -> green -> blue ->
# yellow) so the scene detector has known boundaries to find. The binary is not
# committed; run this locally before the end-to-end flow.
#
set -euo pipefail

OUT="${1:-fixtures/videos/test-cuts.mp4}"
mkdir -p "$(dirname "$OUT")"

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "color=c=red:s=1280x720:d=2:r=30" \
  -f lavfi -i "color=c=green:s=1280x720:d=2:r=30" \
  -f lavfi -i "color=c=blue:s=1280x720:d=2:r=30" \
  -f lavfi -i "color=c=yellow:s=1280x720:d=2:r=30" \
  -filter_complex "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]" \
  -map "[v]" -pix_fmt yuv420p "$OUT"

echo "Wrote $OUT"
