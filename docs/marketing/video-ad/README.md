# InterPoll video ad (EN + FR)

A 1080p30 ad rendered from code: Three.js/WebGL scenes, a synthesized score, and Chatterbox voiceover in English and French. The finished MP4s are not committed (about 40 MB each); this folder is everything needed to rebuild them.

![Poster frame](poster.jpg)

## What's here

| Path | What it does |
|---|---|
| `index.html`, `main.js`, `config.js` | The ad itself. `window.renderFrame(t)` draws any moment deterministically; `?lang=en` or `?lang=fr` picks the copy. |
| `cue_en.json`, `cue_fr.json` | Per-language cue sheets (seconds). Visuals, music and voice placement all read these. |
| `render.mjs`, `shot.mjs`, `serve.mjs` | Headless Chromium frame renderer (Playwright) and a still-frame helper. |
| `tts/lines.json`, `tts/gen.py` | Voiceover script and the Chatterbox multilingual generator (several takes per line). |
| `audio/pick.py` | Transcribes every take with Whisper, drops garbled ones, trims, and picks one per line. |
| `audio/timeline.py` | Builds the cue sheet from the chosen takes, snapped to the 120 BPM grid. |
| `audio/music.py` | Synthesizes the score from the cue sheet (numpy/scipy). |
| `audio/mix.py` | Ducks the music under the voice and writes the final soundtrack. |

## Rebuild

```bash
npm install            # three + fonts; Playwright with Chromium must also be available
```

```bash
node render.mjs en 0 1980 8201     # frames/en/00000.jpg ... (30 fps, 66 s)
```

```bash
node render.mjs fr 0 2160 8202     # 72 s
```

```bash
ffmpeg -framerate 30 -i frames/en/%05d.jpg -i audio/final_en.wav -c:v libx264 -crf 23 -maxrate 4500k -bufsize 9000k -pix_fmt yuv420p -c:a aac -b:a 192k -shortest interpoll-ad-en.mp4
```

The audio side needs Python 3.11 with `chatterbox-tts`, `faster-whisper`, `scipy` and `soundfile`: run `tts/gen.py`, then `audio/pick.py`, `timeline.py`, `music.py` and `mix.py` per language.

## Copy rules

Every claim in the ad comes from the project README and `docs/marketing/launch-copy.md`: signed and hash-chained votes, replication across peers and relays anyone can run, AES-256-GCM private communities, no ads, no tracking, open source. It does not claim perfect one-person-one-vote or that the network is unbreakable.
