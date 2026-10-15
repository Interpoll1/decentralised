# Interpoll — 30s Shorts ad

`interpoll-short.mp4` — 1080×1920, 30 fps, 30.0 s, H.264 + AAC, ~-12 LUFS.
Subtitles are burned in; `interpoll-short.srt` is the same text for platform closed captions.

Everything is generated — no stock footage, no samples, no licensed music:

| Piece | How |
|---|---|
| Look | Tokens from `src/theme-raycast.css` (terminal pass): `#000` canvas, `#3dff7a` accent, hairline greens, scanlines, RGB-split headings, `ip-glitch` slices. Inter / Geist Mono / Grand Hotel (OFL). Bit is drawn from `BitMascot.vue`. |
| App screens | Real Chain Explorer + Resilience Center, captured from `npm run dev` (`shoot_app.cjs`). The feed and poll cards are mockups — the live feed holds other people's posts. |
| Voice | Kokoro-82M TTS (Apache-2.0), voice `af_heart`, speed 1.1 (`vo_gen.py`). |
| Caption timing | Word timestamps from faster-whisper `small.en`, matched back to the script (`align.py`). |
| Music + SFX | Drift-phonk bed synthesised in numpy, 128 BPM, F♯ minor — 808s, cowbell lead, tape-stop, risers, impacts (`music.py`). |
| Frames | `index.html` exposes a deterministic `render(t)`; `render.cjs` drives headless Chromium frame by frame. |

## Re-render

```bash
python3 -m venv venv && ./venv/bin/pip install kokoro-onnx soundfile scipy faster-whisper
# Kokoro model files → models/  (kokoro-v1.0.onnx, voices-v1.0.bin from the kokoro-onnx releases)
# Fonts → fonts/  (GrandHotel-400, GeistMono-400/500/700, Inter-400…900 .ttf from Google Fonts; names in fonts/local.css)
./venv/bin/python vo_gen.py af_heart 1.1   # → vo/*.wav
./venv/bin/python align.py                 # → vo/af_heart_words.json
python3 timeline.py                        # → timeline.json (beat-snapped line starts)
python3 -c "import json;T=json.load(open('timeline.json'));[L.pop('file') for L in T['lines']];open('timeline.js','w').write('window.TL='+json.dumps(T)+';')"
./venv/bin/python music.py                 # → mix.wav
node render.cjs full frames 4              # → frames/f0000.jpg … f0899.jpg   (needs playwright)
ffmpeg -framerate 30 -i frames/f%04d.jpg -i mix.wav -af volume=-3.2dB \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" -c:v libx264 -preset slow -crf 19 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a aac -b:a 256k -movflags +faststart \
  -shortest interpoll-short.mp4
```

Edit the script in `vo_gen.py`; scene timing follows the word timestamps automatically, but `timeline.py`
asserts lines don't overlap — shorten a line or move its slot if it fires.
