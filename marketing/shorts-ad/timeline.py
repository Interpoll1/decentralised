import json
BPM = 128; B = 60 / BPM; DROP = 4.5
k = lambda n: round(DROP + n * B, 4)
starts = [0.20, 3.70, k(0), k(3), k(10), k(18), k(25), k(31), k(38), k(45)]
lines = json.load(open("vo/af_heart_words.json"))
out = []
for L, st in zip(lines, starts):
    out.append({"i": L["i"], "text": L["text"], "file": L["file"], "start": st, "end": round(st + L["dur"], 3),
                "words": [{"w": w["w"], "s": round(st + w["s"], 3), "e": round(st + w["e"], 3)} for w in L["words"]]})
for a, b in zip(out, out[1:]):
    assert a["end"] < b["start"], (a["i"], a["end"], b["start"])
T = {"fps": 30, "dur": 30.0, "bpm": BPM, "beat": B, "drop": DROP, "brk": k(38), "drop2": k(45), "endhit": k(52), "lines": out}
json.dump(T, open("timeline.json", "w"), indent=1)
for L in out:
    print(f'{L["i"]} {L["start"]:6.3f}-{L["end"]:6.3f} ', " ".join(f'{w["w"]}@{w["s"]:.2f}' for w in L["words"]))
print({k_: T[k_] for k_ in ("drop", "brk", "drop2", "endhit")})
