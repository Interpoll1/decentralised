"""Lay VO lines onto a 128 BPM grid anchored at the drop, then derive the section markers the
music (music.py) and visuals (index.html) are built from."""
import json, math, sys
V = sys.argv[1]
BPM = 128; B = 60 / BPM
GAP = 0.16                                   # minimum breath between lines
lines = json.load(open(f"build/{V}/voice_words.json"))
dur = [L["dur"] for L in lines]

def snap(t, grid):                            # next grid point at/after t (grid anchored at DROP)
    return DROP + math.ceil((t - DROP) / grid - 1e-9) * grid

st = [0.0] * len(lines)
st[0] = 0.15
st[1] = st[0] + dur[0] + 0.28
DROP = round(st[1] + dur[1] + 0.22, 4)       # the beat drops on "This is Interpoll."
st[2] = DROP
for i in range(3, 9):                         # features on half-beats; the break starts with line 8
    st[i] = snap(st[i - 1] + dur[i - 1] + GAP, B / 2)
BRK = st[8]
DROP2 = snap(st[8] + dur[8] + 0.28, B / 2)
st[9] = DROP2
END = snap(st[9] + dur[9] + 0.12, B / 2)
assert END <= 29.25, f"too long: end hit at {END:.2f}s — raise the TTS speed"

out = []
for L, s in zip(lines, st):
    out.append({"i": L["i"], "text": L["text"], "file": L["file"], "start": round(s, 4), "end": round(s + L["dur"], 3),
                "words": [{"w": w["w"], "s": round(s + w["s"], 3), "e": round(s + w["e"], 3)} for w in L["words"]]})
for a, b in zip(out, out[1:]):
    assert a["end"] < b["start"], (a["i"], a["end"], b["start"])
T = {"fps": 30, "dur": 30.0, "bpm": BPM, "beat": B, "drop": DROP, "brk": round(BRK, 4), "drop2": round(DROP2, 4),
     "endhit": round(END, 4), "lines": out}
json.dump(T, open(f"build/{V}/timeline.json", "w"), indent=1)
web = json.loads(json.dumps(T))
for L in web["lines"]:
    L.pop("file")
cfg = json.load(open(f"versions/{V}.json"))
open(f"build/{V}/timeline.js", "w").write("window.TL=" + json.dumps(web) + ";")
open(f"build/{V}/copy.js", "w").write("window.COPY=" + json.dumps(dict(cfg["copy"], cues=cfg["cues"])) + ";")
for L in out:
    print(f'{L["i"]} {L["start"]:6.3f}-{L["end"]:6.3f} ', " ".join(f'{w["w"]}@{w["s"]:.2f}' for w in L["words"]))
print({k: T[k] for k in ("drop", "brk", "drop2", "endhit")})
