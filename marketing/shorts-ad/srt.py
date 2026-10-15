"""Closed-caption .srt for one version, one cue per VO line.   usage: srt.py <version>"""
import json, sys
V = sys.argv[1]
T = json.load(open(f"build/{V}/timeline.json"))
def ts(x):
    ms = int(round(x * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
L = T["lines"]
cues = []
for n, line in enumerate(L):
    end = min(line["end"] + 0.3, L[n + 1]["start"] - 0.02) if n + 1 < len(L) else T["dur"]
    cues.append(f"{n + 1}\n{ts(line['start'])} --> {ts(end)}\n{line['text']}\n")
open(f"build/{V}/interpoll-{V}.srt", "w").write("\n".join(cues))
print(f"build/{V}/interpoll-{V}.srt", len(cues), "cues")
