#!/usr/bin/env bash
# Build one version end to end:  ./make.sh <version> [audio|video|all]
set -euo pipefail
cd "$(dirname "$0")"
V=$1; STEP=${2:-all}
PY=./venv/bin/python
if [[ $STEP == audio || $STEP == all ]]; then
  $PY vo_gen.py "$V"
  $PY align.py "$V"
  python3 timeline.py "$V"
  $PY music.py "$V"
fi
if [[ $STEP == video || $STEP == all ]]; then
  rm -rf "build/$V/frames"
  NODE_PATH=${NODE_PATH:-/opt/node22/lib/node_modules} node render.cjs "$V" full 4
  ffmpeg -hide_banner -loglevel error -y -framerate 30 -i "build/$V/frames/f%04d.jpg" -i "build/$V/mix.wav" \
    -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" -c:v libx264 -preset slow -crf 21 -maxrate 8M -bufsize 16M \
    -profile:v high -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a aac -b:a 256k -ar 48000 \
    -movflags +faststart -shortest "build/$V/interpoll-$V.mp4"
  ffprobe -v error -show_entries format=duration,size -of compact "build/$V/interpoll-$V.mp4"
fi
