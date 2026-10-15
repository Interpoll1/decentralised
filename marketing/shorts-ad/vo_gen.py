import sys, json, soundfile as sf, numpy as np
from kokoro_onnx import Kokoro
k = Kokoro("models/kokoro-v1.0.onnx", "models/voices-v1.0.bin")
LINES = [
 "They can delete your posts. Ban your account. Erase your vote.",
 "Not here.",
 "This is Interpoll.",
 "Every vote is signed by a key that never leaves your device.",
 "Every block chains to the last. Touch one, and the chain snaps.",
 "No central server. Your posts live on every peer.",
 "Relay goes down? The network heals itself.",
 "Private spaces? Encrypted. Relays only see noise.",
 "No algorithm. No shadow bans. No off switch.",
 "Interpoll. Free. Open source. Owned by no one.",
]
voice = sys.argv[1]; speed = float(sys.argv[2])
out = []
for i, line in enumerate(LINES):
    a, sr = k.create(line, voice=voice, speed=speed, lang="en-us")
    # trim leading/trailing silence
    thr = 0.01; idx = np.where(np.abs(a) > thr)[0]
    a = a[max(0, idx[0]-int(0.02*sr)): idx[-1]+int(0.06*sr)]
    fn = f"vo/{voice}_{i:02d}.wav"; sf.write(fn, a, sr)
    out.append({"i": i, "text": line, "file": fn, "dur": len(a)/sr})
    print(f"{i:2d} {len(a)/sr:5.2f}s  {line}")
print("TOTAL", sum(o["dur"] for o in out))
json.dump(out, open(f"vo/{voice}.json", "w"), indent=1)
