"""Word timestamps for caption sync: faster-whisper on each VO line, matched back to the script words.
usage: align.py <version>"""
import json, re, difflib, sys
import numpy as np, soundfile as sf
from faster_whisper import WhisperModel

V = sys.argv[1]
m = WhisperModel("small.en", device="cpu", compute_type="int8")
lines = json.load(open(f"build/{V}/voice.json"))
key = lambda w: re.sub(r"[^a-z0-9]", "", w.lower())
for L in lines:
    a, sr = sf.read(L["file"], dtype="float32")
    a16 = np.interp(np.arange(0, len(a) / sr, 1 / 16000), np.arange(len(a)) / sr, a).astype(np.float32)
    segs, _ = m.transcribe(a16, word_timestamps=True, beam_size=5, language="en")
    ww = [w for s in segs for w in s.words]
    heard, script = [key(w.word) for w in ww], L["text"].split()
    times = [None] * len(script)
    sm = difflib.SequenceMatcher(a=[key(w) for w in script], b=heard, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal" or (tag == "replace" and i2 - i1 == j2 - j1):
            for k in range(i2 - i1):
                times[i1 + k] = (ww[j1 + k].start, ww[j1 + k].end)
        elif tag == "replace":                       # spread the heard span over the script span
            st, en, n = ww[j1].start, ww[j2 - 1].end, i2 - i1
            for k in range(n):
                times[i1 + k] = (st + (en - st) * k / n, st + (en - st) * (k + 1) / n)
    for k in range(len(times)):                      # interpolate anything still missing
        if times[k] is None:
            prev = times[k - 1][1] if k and times[k - 1] else 0.0
            times[k] = (prev, next((t[0] for t in times[k + 1:] if t), L["dur"]))
    L["words"] = [{"w": w, "s": round(s, 3), "e": round(e, 3)} for w, (s, e) in zip(script, times)]
    print(L["i"], " ".join(w.word.strip() for w in ww))
json.dump(lines, open(f"build/{V}/voice_words.json", "w"), indent=1)
