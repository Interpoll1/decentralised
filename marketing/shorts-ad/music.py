"""Synthesised drift-phonk bed + SFX + VO mix for the Interpoll short.
Everything is generated here (no samples), so the track is royalty-free."""
import json
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve, resample_poly

SR = 48000
T = json.load(open("timeline.json"))
DUR = T["dur"]
B = T["beat"]
DROP, BRK, DROP2, END = T["drop"], T["brk"], T["drop2"], T["endhit"]
N = int(DUR * SR)
rng = np.random.default_rng(7)

def buf():
    return np.zeros((N, 2))

def place(dst, sig, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= N or i + len(sig) <= 0:
        return
    if sig.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * l * 1.414, sig * r * 1.414], 1)
    j0 = max(0, -i)
    n = min(len(sig), N - i)
    dst[i + j0:i + n] += sig[j0:n] * gain

def filt(x, kind, f, order=2):
    sos = butter(order, f, btype=kind, fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)

def sweep(x, fc_fn, kind, blk=512):
    """Time-varying Butterworth filter; coefficient per block, state carried across blocks."""
    out = np.zeros_like(x)
    zi = None
    for i in range(0, len(x), blk):
        sos = butter(2, fc_fn(i), btype=kind, fs=SR, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2) + x.shape[1:])
        out[i:i + blk], zi = sosfilt(sos, x[i:i + blk], axis=0, zi=zi)
    return out

def env_exp(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))

def tt(d):
    return np.arange(int(d * SR)) / SR

def note(name):
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "E#": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    nm, octv = name[:-1], int(name[-1])
    midi = 12 * (octv + 1) + names[nm]
    return 440 * 2 ** ((midi - 69) / 12)

def ir(seconds=1.4, damp=4500, seed=1):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    e = np.exp(-np.arange(n) / (seconds / 5.5 * SR))
    x = r.standard_normal((n, 2)) * e[:, None]
    return filt(x, "lowpass", damp) * 0.12

IR = ir()

def reverb(x, wet=0.3):
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    y = np.stack([fftconvolve(x[:, c], IR[:, c])[:len(x)] for c in range(2)], 1)
    return x * (1 - wet) + y * wet

# ---------------------------------------------------------------- instruments
def kick():
    t = tt(0.5)
    f = 48 + 120 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.28)
    click = filt(rng.standard_normal(len(t)) * np.exp(-t / 0.003), "highpass", 2500) * 0.5
    return np.tanh(1.6 * (body + click)) * 0.9

def b808(freq, length, glide_to=None):
    t = tt(length + 0.05)
    f = freq * (1 + 0.9 * np.exp(-t / 0.02))
    if glide_to:
        g = np.clip((t - length * 0.55) / (length * 0.35), 0, 1)
        f = f * (glide_to / freq) ** g
    ph = 2 * np.pi * np.cumsum(f) / SR
    a = np.minimum(1, t / 0.003) * np.where(t < length, 1.0, np.exp(-(t - length) / 0.015)) * np.exp(-t / 1.6)
    x = np.sin(ph) + 0.25 * np.sin(2 * ph)
    y = np.tanh(3.2 * x * a) * 0.55
    return filt(y, "lowpass", 3200)

def clap():
    t = tt(0.35)
    n = rng.standard_normal(len(t))
    e = np.zeros(len(t))
    for d in (0, 0.009, 0.019):
        e += (t >= d) * np.exp(-np.maximum(t - d, 0) / 0.006)
    e += (t >= 0.028) * np.exp(-np.maximum(t - 0.028, 0) / 0.09)
    x = filt(n * e, "bandpass", [900, 5200])
    snare = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.05) * 0.5
    return np.tanh(2.2 * (x * 1.4 + snare)) * 0.55

def hat(open_=False):
    t = tt(0.32 if open_ else 0.06)
    x = filt(rng.standard_normal(len(t)), "highpass", 7500)
    return x * np.exp(-t / (0.11 if open_ else 0.014)) * 0.35

def cowbell(freq, length=0.16):
    t = tt(length)
    sq = lambda f: np.sign(np.sin(2 * np.pi * f * t))
    x = sq(freq) * 0.6 + sq(freq * 1.4836) * 0.4
    x = filt(x, "bandpass", [freq * 0.9, min(freq * 5, 12000)])
    e = 0.7 * np.exp(-t / 0.018) + 0.3 * np.exp(-t / 0.09)
    return x * e * 0.32

def pad_chord(freqs, length):
    t = tt(length)
    x = np.zeros((len(t), 2))
    for f in freqs:
        for c, det in enumerate((0.996, 1.004)):
            ph = (f * det * t) % 1.0
            x[:, c] += (2 * ph - 1)
    a = np.minimum(1, t / 0.08) * np.minimum(1, (length - t) / 0.08)
    x = filt(x * a[:, None], "lowpass", 1100) * 0.06
    return x

def riser(length, f0=300, f1=9000):
    t = tt(length)
    p = t / length
    x = rng.standard_normal(len(t))
    def band(i):
        fc = f0 * (f1 / f0) ** p[i]
        return [fc * 0.7, min(fc * 1.4, 20000)]
    out = sweep(x, band, "bandpass")
    tone = np.sin(2 * np.pi * np.cumsum(180 * (8 ** p)) / SR) * 0.25
    return (out * 0.9 + tone) * (p ** 2.2) * 0.5

def impact(big=1.0):
    t = tt(2.2)
    f = 30 + 55 * np.exp(-t / 0.25)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.7)
    noise = filt(rng.standard_normal(len(t)), "lowpass", 2600) * np.exp(-t / 0.18) * 0.6
    x = np.tanh(1.8 * (sub + noise)) * 0.8 * big
    return reverb(x, 0.35)

def whoosh(length=0.45, up=True):
    t = tt(length)
    p = t / length if up else 1 - t / length
    x = rng.standard_normal(len(t))
    def band(i):
        fc = 400 * (12 ** p[i])
        return [fc * 0.6, min(fc * 1.6, 20000)]
    out = sweep(x, band, "bandpass")
    e = np.sin(np.pi * t / length) ** 2
    return out * e * 0.35

def blip(f=1800, length=0.07):
    t = tt(length)
    return np.sin(2 * np.pi * f * t) * np.exp(-t / 0.018) * 0.25

def click():
    t = tt(0.03)
    return filt(rng.standard_normal(len(t)), "bandpass", [2000, 7000]) * np.exp(-t / 0.004) * 0.6

def glitch_burst(length=0.25):
    t = tt(length)
    x = np.sign(np.sin(2 * np.pi * (300 + 2500 * rng.random()) * t)) * (rng.random(len(t)) > 0.5)
    x = x * ((t * 60) % 1 < 0.5)
    return filt(x.astype(float), "bandpass", [500, 6000]) * np.exp(-t / 0.12) * 0.28

def power_down(length=0.6):
    t = tt(length)
    f = 900 * np.exp(-t / 0.15) + 40
    x = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * np.exp(-t / 0.25)
    return filt(x, "lowpass", 3000) * 0.18

def lock_snap():
    t = tt(0.12)
    a = filt(rng.standard_normal(len(t)), "bandpass", [1500, 6000]) * np.exp(-t / 0.006)
    b = np.sin(2 * np.pi * 2400 * t) * np.exp(-t / 0.02) * 0.4
    return (a + b) * 0.5

# ---------------------------------------------------------------- arrangement
drums, bass, lead, pads, fx = buf(), buf(), buf(), buf(), buf()

PROG = [("F#", [note("F#3"), note("A3"), note("C#4")], note("F#1")),
        ("D",  [note("D3"), note("F#3"), note("A3")], note("D2")),
        ("E",  [note("E3"), note("G#3"), note("B3")], note("E2")),
        ("C#", [note("C#3"), note("E#3"), note("G#3")], note("C#2"))]
RIFF = [
    {0: "C#6", 3: "C#6", 6: "A5", 8: "B5", 10: "C#6", 12: "A5", 14: "F#5"},
    {0: "D6", 3: "D6", 6: "A5", 8: "B5", 10: "A5", 12: "F#5", 14: "A5"},
    {0: "E6", 3: "E6", 6: "B5", 8: "C#6", 10: "B5", 12: "G#5", 14: "B5"},
    {0: "G#5", 3: "G#5", 6: "E#5", 8: "G#5", 10: "C#6", 12: "B5", 14: "G#5", 15: "E#5"},
]
S16 = B / 4
K, CL, OH = kick(), clap(), hat(True)
HAT = hat()

def bar(t0, bi, full=True, until=None, lead_on=True, hats_open=False):
    """One bar of the main groove starting at t0 (bar index bi picks chord)."""
    name, chord, root = PROG[bi % 4]
    lim = until if until is not None else 1e9
    def ok(t):
        return t < lim - 0.005
    # 808 + kick
    for step, ln, glide in ((0, 5, None), (6, 3, None), (10, 4, None), (14, 2, root * 2)):
        t = t0 + step * S16
        if ok(t):
            place(bass, b808(root, ln * S16, glide), t, 0.9)
            if step in (0, 6, 10):
                place(drums, K, t, 0.85)
    # claps on 2 & 4
    for step in (4, 12):
        if ok(t0 + step * S16):
            place(drums, CL, t0 + step * S16, 0.8)
    # hats: 8ths, 16th/32nd roll at the end of odd bars
    for step in range(0, 16, 2):
        t = t0 + step * S16
        if ok(t):
            place(drums, HAT, t, 0.55 if step % 4 == 0 else 0.4, pan=0.25)
    if bi % 2 == 1:
        for j in range(8):
            t = t0 + 12 * S16 + j * S16 / 2
            if ok(t):
                place(drums, HAT, t, 0.25 + 0.03 * j, pan=0.25)
    if hats_open:
        for step in (2, 6, 10, 14):
            if ok(t0 + step * S16):
                place(drums, OH, t0 + step * S16, 0.35, pan=-0.2)
    if lead_on:
        for step, nm in RIFF[bi % 4].items():
            t = t0 + step * S16
            if ok(t):
                cb = cowbell(note(nm))
                place(lead, cb, t, 0.8, pan=-0.15)
                place(lead, cb, t + 0.012, 0.45, pan=0.6)   # Haas width
    place(pads, pad_chord(chord, min(4 * B, lim - t0)), t0, 1.0)

# --- intro: filtered teaser groove (grid anchored to the drop) -----------------
intro = buf()
saved = (drums, bass, lead, pads)
drums, bass, lead, pads = intro, intro, intro, intro
STOP = DROP - 2 * B           # tape-stop point, right before "Not here."
for bi in range(-3, 0):
    bar(DROP + bi * 4 * B, bi + 3, until=STOP)
drums, bass, lead, pads = saved
# low-pass sweep on the intro 350Hz -> 3kHz
p = np.clip(np.arange(N) / (STOP * SR), 0, 1)
intro = sweep(intro, lambda i: 350 * (3000 / 350) ** (p[i] ** 1.5), "lowpass")
# tape stop over 0.32s
i0, L = int(STOP * SR), int(0.32 * SR)
rate = (1 - np.arange(L) / L) ** 1.6
pos = i0 + np.cumsum(rate)
ts = np.stack([np.interp(pos, np.arange(N), intro[:, c]) for c in range(2)], 1)
ts *= np.linspace(1, 0, L)[:, None] ** 0.5
intro[i0:i0 + L] = ts
intro[i0 + L:] = 0
music = intro * 0.9

# --- drop 1 ----------------------------------------------------------------
bi, t = 0, DROP
while t < BRK - 1e-6:
    bar(t, bi, until=BRK, hats_open=(bi >= 4))
    t += 4 * B
    bi += 1
# --- break: pad only, filtered -------------------------------------------------
place(pads, pad_chord(PROG[0][1], DROP2 - BRK) * 0.8, BRK)
# --- drop 2 ----------------------------------------------------------------
bi, t = 0, DROP2
while t < END - 1e-6:
    bar(t, bi, until=END, hats_open=True)
    t += 4 * B
    bi += 1
# end: one long 808 + kick
place(bass, b808(note("F#1"), 1.0), END, 1.0)
place(drums, K, END, 1.0)

# kick-driven pump on pads and lead (sidechain feel)
pump = np.ones(N)
for kt in np.arange(DROP, END + 1, B):
    i = int(kt * SR)
    n = int(0.22 * SR)
    seg = 1 - 0.55 * np.exp(-np.arange(n) / (0.07 * SR))
    pump[i:i + n] = np.minimum(pump[i:i + n], seg[:max(0, min(n, N - i))])
pads *= pump[:, None]
lead *= (0.5 + 0.5 * pump)[:, None]

# stutter glitch on "snaps": retrigger a 1/32 slice of the groove
def stutter(at, reps=6):
    i = int(at * SR)
    n = int(S16 / 2 * SR)
    for bus in (drums, bass, lead):
        sl = bus[i:i + n].copy()
        for r in range(reps):
            bus[i + r * n:i + (r + 1) * n] = sl * (1 - r / (reps + 2))

words = {(L["i"], w["w"].strip(".,?").lower()): w for L in T["lines"] for w in L["words"]}
snap_t = words[(4, "snaps")]["s"]
stutter(snap_t)

music = music + drums * 0.95 + bass * 0.8 + lead * 0.85 + pads * 1.0
music = filt(music, "highpass", 28)

# --- SFX -------------------------------------------------------------------
place(fx, impact(1.0), 0.0, 0.9)
place(fx, glitch_burst(0.3), 0.02, 0.8)
for w in ("delete", "ban", "erase"):
    place(fx, glitch_burst(0.22), words[(0, w)]["s"], 0.7)
place(fx, riser(STOP - 1.4), 1.4, 0.5)
# reverse swell into the drop
rs = whoosh(0.55, up=True)
place(fx, rs, DROP - 0.55, 0.8)
place(fx, impact(1.2), DROP, 1.0)
# scene whooshes on line starts
for i in (3, 4, 5, 6, 7):
    st = T["lines"][i]["start"]
    place(fx, whoosh(0.4), st - 0.3, 0.55)
place(fx, blip(1400), words[(3, "signed")]["s"], 0.7)
place(fx, blip(2100), words[(3, "signed")]["s"] + 0.09, 0.6)
place(fx, click(), words[(4, "touch")]["s"] + 0.1, 0.9)
place(fx, impact(0.6), snap_t, 0.8)
place(fx, glitch_burst(0.35), snap_t, 0.9)
place(fx, impact(0.4), words[(5, "no")]["s"], 0.6)
place(fx, glitch_burst(0.3), words[(5, "server")]["s"], 0.6)
place(fx, power_down(), words[(6, "down")]["s"], 0.9)
for k_ in range(5):
    place(fx, blip(1200 + 260 * k_, 0.05), words[(6, "heals")]["s"] + 0.07 * k_, 0.45)
place(fx, lock_snap(), words[(7, "encrypted")]["s"], 1.0)
place(fx, glitch_burst(0.5), words[(7, "noise")]["s"], 0.5)
# break: impacts on each "No"
nos = [w for w in T["lines"][8]["words"] if w["w"].lower().startswith("no")]
for j, w in enumerate(nos):
    place(fx, impact(0.9 + 0.15 * j), w["s"], 0.95)
place(fx, click(), words[(8, "switch")]["s"] + 0.05, 1.0)
place(fx, riser(DROP2 - 0.15 - (nos[-1]["s"] + 0.5)), nos[-1]["s"] + 0.5, 0.55)
place(fx, impact(1.3), DROP2, 1.0)
place(fx, whoosh(0.5), DROP2 - 0.5, 0.7)
for w in ("free", "open", "owned"):
    place(fx, blip(1700, 0.06), words[(9, w)]["s"], 0.5)
place(fx, impact(1.4), END, 1.0)

# --- VO --------------------------------------------------------------------
vo = np.zeros(N)
for L in T["lines"]:
    a, sr = sf.read(L["file"], dtype="float64")
    a = resample_poly(a, SR, sr)
    i = int(L["start"] * SR)
    vo[i:i + len(a)] += a[:N - i]
vo = filt(vo, "highpass", 90)
# presence lift: add a band-passed copy
vo = vo + 0.35 * filt(vo, "bandpass", [2500, 6000])
# simple compressor
env = np.sqrt(fftconvolve(vo ** 2, np.ones(int(0.01 * SR)) / int(0.01 * SR), mode="same").clip(1e-12))
thr = 0.08
gain = np.where(env > thr, (thr / env) ** 0.6, 1.0)
vo = vo * gain
vo = vo / np.max(np.abs(vo)) * 0.92
vo_st = np.stack([vo, vo], 1)
# echo throw on "Not here."
nh = T["lines"][1]
i0, i1 = int(nh["start"] * SR), int((nh["end"] + 0.05) * SR)
throw = np.zeros((N, 2))
throw[i0:i1] = vo_st[i0:i1]
for d, g, pan in ((0.234, 0.45, -0.6), (0.469, 0.28, 0.6), (0.703, 0.16, -0.3)):
    j = int(d * SR)
    throw_d = np.zeros((N, 2))
    throw_d[i0 + j:i1 + j] = vo_st[i0:i1] * g
    throw_d[:, 0] *= (1 - pan) / 1.0
    throw_d[:, 1] *= (1 + pan) / 1.0
    vo_st = vo_st + filt(throw_d, "bandpass", [400, 4000]) * 0.8

# --- ducking + master --------------------------------------------------------
venv = np.sqrt(fftconvolve(vo ** 2, np.ones(int(0.05 * SR)) / int(0.05 * SR), mode="same").clip(0))
venv = venv / (venv.max() + 1e-9)
# smooth attack/release
sm = np.zeros(N)
a_att, a_rel = np.exp(-1 / (0.01 * SR)), np.exp(-1 / (0.25 * SR))
v = 0.0
for i in range(0, N, 64):
    x = min(1.0, venv[i] * 4)
    co = a_att ** 64 if x > v else a_rel ** 64
    v = co * v + (1 - co) * x
    sm[i:i + 64] = v
duck = 1 - 0.5 * sm
mix = music * duck[:, None] * 0.8 + fx * (1 - 0.25 * sm)[:, None] * 0.75 + vo_st * 1.0
# fade tail
fo = int((DUR - 0.6) * SR)
mix[fo:] *= np.linspace(1, 0, N - fo)[:, None] ** 1.5
# soft limiter
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
mix = mix / np.max(np.abs(mix)) * 0.97
sf.write("mix.wav", mix.astype(np.float32), SR)
sf.write("music_only.wav", (music * 0.8 + fx * 0.75).astype(np.float32) / max(1e-9, np.max(np.abs(music * 0.8 + fx * 0.75))) * 0.95, SR)
print("ok", mix.shape, "peak", np.max(np.abs(mix)))
