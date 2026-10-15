# Interpoll — 30s Shorts ads

Two cuts, same look and beat, different words:

| File | For | Voice script |
|---|---|---|
| `interpoll-short.mp4` | people who already care about decentralisation | `versions/main.json` |
| `interpoll-short-genz.mp4` | people who "get nothing about tech" — no jargon, Gen Z phrasing | `versions/genz.json` |

Both: 1080×1920, 30 fps, 30.0 s, H.264 + AAC 256k, −14 LUFS integrated / −1.5 dBTP (YouTube's target, so it isn't turned down).
Subtitles are burned in word-by-word; the matching `.srt` is for platform closed captions.

Everything is generated — no stock footage, no samples, no licensed music:

| Piece | How |
|---|---|
| Look | Tokens from `src/theme-raycast.css` (terminal pass): `#000` canvas, `#3dff7a` accent, hairline greens, scanlines, RGB-split headings, `ip-glitch` slices. Inter / Geist Mono / Grand Hotel (OFL). Bit is drawn from `BitMascot.vue`. |
| App screens | Real Chain Explorer + Resilience Center, captured from `npm run dev` (`shoot_app.cjs`). Feed/poll cards are mockups — the live feed holds other people's posts. |
| Voice | Kokoro-82M TTS (Apache-2.0): 70% `am_onyx` + 30% `am_michael` blend, then −1 semitone by resampling (deeper pitch *and* formants, no pitch-shifter artifacts). ~92 Hz median pitch. |
| Caption timing | faster-whisper `small.en` word timestamps, matched back to the script (`align.py`). |
| Music + SFX | Phonk bed synthesised in numpy (`music.py`), 128 BPM, F♯ minor: kick + gliding 808, 808-style metallic hats (no white-noise hiss), band-limited cowbell hook in 3-3-2, FM bells, tape-stop, reversed-bell swells, sub impacts. Melody ducks 9 dB / beat 4.5 dB under the voice. Lookahead limiter, no master saturation. |
| Frames | `index.html?v=<version>` exposes a deterministic `render(t)`; `render.cjs` drives headless Chromium frame by frame. |

## Editing

A version is one JSON file in `versions/`:

* `lines` — the voiceover, one entry per scene (10 scenes; keep the order).
* `cues` — which spoken word each visual/SFX hit lands on: `[line, word, nth occurrence, offset s]`.
* `copy` — every on-screen string (labels, terminal lines, chips, CTA).

`timeline.py` snaps lines to the beat grid and fails if the cut runs past ~29.25 s; raise `speed` or trim a line.

## Build

```bash
python3 -m venv venv && ./venv/bin/pip install kokoro-onnx soundfile scipy faster-whisper pyloudnorm
# Kokoro model files → models/  (kokoro-v1.0.onnx, voices-v1.0.bin from the kokoro-onnx releases)
# Fonts → fonts/  (GrandHotel-400, GeistMono-400/500/700, Inter-400…900 .ttf from Google Fonts; names in fonts/local.css)
./make.sh main          # VO → word timing → timeline → music/mix → frames → build/main/interpoll-main.mp4
./make.sh genz
python3 srt.py main     # → build/main/interpoll-main.srt
```

`./make.sh <version> audio` or `video` runs half the pipeline.
