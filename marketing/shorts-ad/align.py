import json, re, difflib, numpy as np, soundfile as sf
from faster_whisper import WhisperModel
m = WhisperModel("small.en", device="cpu", compute_type="int8")
lines = json.load(open("vo/af_heart.json"))
for L in lines:
    a, sr = sf.read(L["file"], dtype="float32"); t16 = np.arange(0, len(a)/sr, 1/16000); a16 = np.interp(t16, np.arange(len(a))/sr, a).astype(np.float32)
    segs, _ = m.transcribe(a16, word_timestamps=True, beam_size=5, language="en")
    ww = [w for s in segs for w in s.words]
    heard = [re.sub(r"[^a-z0-9]", "", w.word.lower()) for w in ww]
    script = L["text"].split()
    norm = [re.sub(r"[^a-z0-9]", "", w.lower()) for w in script]
    sm = difflib.SequenceMatcher(a=norm, b=heard, autojunk=False)
    times = [None]*len(script)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal" or (tag == "replace" and i2-i1 == j2-j1):
            for k in range(i2-i1): times[i1+k] = (ww[j1+k].start, ww[j1+k].end)
        elif tag == "replace":
            # spread the heard span over the script span
            st, en = ww[j1].start, ww[j2-1].end
            n = i2-i1
            for k in range(n): times[i1+k] = (st+(en-st)*k/n, st+(en-st)*(k+1)/n)
    # fill gaps by interpolation
    for k in range(len(times)):
        if times[k] is None:
            prev = times[k-1][1] if k>0 and times[k-1] else 0.0
            nxt = next((t[0] for t in times[k+1:] if t), L["dur"])
            times[k] = (prev, nxt)
    L["words"] = [{"w": w, "s": round(a,3), "e": round(b,3)} for w,(a,b) in zip(script, times)]
    print(L["i"], " ".join(w.word.strip() for w in ww), "|", [(x["w"], x["s"]) for x in L["words"]][:4])
json.dump(lines, open("vo/af_heart_words.json","w"), indent=1)
