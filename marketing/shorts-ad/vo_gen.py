"""Voiceover for one version: Kokoro TTS voice blend, then -1 semitone by resampling (lowers pitch *and*
formants -> bigger, trailer-style voice, no phase-vocoder artifacts).   usage: vo_gen.py <version>"""
import json, os, sys
import numpy as np, soundfile as sf
from scipy.signal import resample_poly
from kokoro_onnx import Kokoro
from voicelib import f0

V = sys.argv[1]
cfg = json.load(open(f"versions/{V}.json"))
os.makedirs(f"build/{V}/vo", exist_ok=True)
k = Kokoro("models/kokoro-v1.0.onnx", "models/voices-v1.0.bin")
UP, DOWN = 18, 17                     # 18/17 ~= 2^(1/12): one semitone down
style = sum(w * k.get_voice_style(v) for v, w in cfg["voice"].items())
out = []
for i, line in enumerate(cfg["lines"]):
    a, sr = k.create(line, voice=style, speed=cfg["speed"] * UP / DOWN, lang="en-us")
    a = resample_poly(a, UP, DOWN)    # played back at sr -> 1 semitone lower, original pace
    idx = np.where(np.abs(a) > 0.01)[0]
    a = a[max(0, idx[0] - int(0.02 * sr)): idx[-1] + int(0.08 * sr)]
    fn = f"build/{V}/vo/{i:02d}.wav"; sf.write(fn, a, sr)
    out.append({"i": i, "text": line, "file": fn, "dur": len(a) / sr})
    print(f"{i:2d} {len(a)/sr:5.2f}s  {line}")
print("TOTAL", round(sum(o["dur"] for o in out), 2), "F0", round(f0(np.concatenate([sf.read(o['file'])[0] for o in out]), 24000), 1))
json.dump(out, open(f"build/{V}/voice.json", "w"), indent=1)
