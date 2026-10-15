"""Phonk bed + SFX + VO mix for the Interpoll short, synthesised from scratch (no samples, royalty-free).

Sound design rules that keep it clean:
  * every pitched oscillator is band-limited (additive) -> no aliasing fizz
  * hi-hats are 808-style metal (six detuned squares), not white noise
  * no waveshaping on the master: levels are staged, then a lookahead limiter + loudness target
"""
import json, re, sys
import numpy as np
import soundfile as sf
import pyloudnorm as pyln
from scipy.signal import butter, sosfilt, sosfiltfilt, fftconvolve, resample_poly
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000
V = sys.argv[1]
T = json.load(open(f"build/{V}/timeline.json"))
CUES = json.load(open(f"versions/{V}.json"))["cues"]
DUR, B = T["dur"], T["beat"]
S16 = B / 4
DROP, BRK, DROP2, END = T["drop"], T["brk"], T["drop2"], T["endhit"]
N = int(DUR * SR)
rng = np.random.default_rng(11)
LUFS_TARGET, CEILING = -14.0, 10 ** (-1.5 / 20)

# ------------------------------------------------------------------ helpers
def tt(d):
    return np.arange(int(d * SR)) / SR

def _f(x, kind, f, order=2, zero_phase=False):
    sos = butter(order, f, btype=kind, fs=SR, output="sos")
    return sosfiltfilt(sos, x, axis=0) if zero_phase else sosfilt(sos, x, axis=0)

lp = lambda x, f, o=2: _f(x, "lowpass", f, o)
hp = lambda x, f, o=2: _f(x, "highpass", f, o)
bp = lambda x, a, b, o=2: _f(x, "bandpass", [a, b], o)

def norm(x, peak=1.0):
    m = np.max(np.abs(x))
    return x / m * peak if m > 0 else x

def stereo(x, pan=0.0):
    if x.ndim == 2:
        return x
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return np.stack([x * l, x * r], 1) * 1.4142

def bus():
    return np.zeros((N, 2))

def place(dst, sig, t, gain=1.0, pan=0.0):
    sig = stereo(sig, pan)
    i = int(round(t * SR))
    j0 = max(0, -i)
    n = min(len(sig), N - i)
    if n > j0:
        dst[i + j0:i + n] += sig[j0:n] * gain

def sweep(x, fc_fn, kind, blk=512):
    """Time-varying Butterworth; coefficients per block, filter state carried across blocks."""
    out, zi = np.zeros_like(x), None
    for i in range(0, len(x), blk):
        sos = butter(2, fc_fn(i), btype=kind, fs=SR, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2) + x.shape[1:])
        out[i:i + blk], zi = sosfilt(sos, x[i:i + blk], axis=0, zi=zi)
    return out

def note(name):
    idx = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "E#": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    return 440 * 2 ** ((12 * (int(name[-1]) + 1) + idx[name[:-1]] - 69) / 12)

def sq(f, t, fmax=18000):
    """Band-limited square (odd harmonics below fmax)."""
    y, k = np.zeros_like(t), 1
    while k * f < fmax:
        y += np.sin(2 * np.pi * k * f * t) / k
        k += 2
    return y * 4 / np.pi

def saw(f, t, fmax=6000):
    y, k = np.zeros_like(t), 1
    while k * f < fmax:
        y += (-1) ** (k + 1) * np.sin(2 * np.pi * k * f * t) / k
        k += 1
    return y * 2 / np.pi

def make_ir(sec, damp, seed):
    r = np.random.default_rng(seed)
    n = int(sec * SR)
    e = np.exp(-np.arange(n) / (sec / 6 * SR))
    ir = lp(r.standard_normal((n, 2)) * e[:, None], damp, 2)
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))[:, None]   # soft pre-delay
    return ir / np.sqrt(np.sum(ir ** 2) / 2)

IR_ROOM, IR_HALL = make_ir(0.7, 3500, 1), make_ir(2.4, 2800, 2)

def verb(x, ir=None, wet=0.2):
    ir = IR_ROOM if ir is None else ir
    x = stereo(x)
    y = np.stack([fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], 1)
    return x * (1 - wet) + y * wet * 0.5

# ------------------------------------------------------------------ instruments
def kick():
    t = tt(0.5)
    f = 46 + 115 * np.exp(-t / 0.04) + 160 * np.exp(-t / 0.006)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.minimum(1, t / 0.0008) * np.exp(-t / 0.30)
    click = bp(rng.standard_normal(len(t)), 1500, 5000) * np.exp(-t / 0.002) * 0.15
    return norm(np.tanh(1.4 * (body + click)))

def b808(f0, length, glide_to=None):
    t = tt(length + 0.06)
    f = np.full(len(t), f0) * (1 + 0.16 * np.exp(-t / 0.014))
    if glide_to:
        p = np.clip((t - length * 0.45) / (length * 0.45), 0, 1)
        f = f * (glide_to / f0) ** (p * p * (3 - 2 * p))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    y = 0.5 * x + 0.5 * np.tanh(2.4 * x) / np.tanh(2.4)        # harmonics so it reads on phone speakers
    env = np.minimum(1, t / 0.004) * np.where(t < length, 1.0, np.exp(-(t - length) / 0.02)) * (0.65 + 0.35 * np.exp(-t / 1.0))
    return lp(y * env, 1400, 4)

def clap():
    t = tt(0.45)
    e = sum((t >= d) * np.exp(-np.maximum(t - d, 0) / 0.0045) for d in (0.0, 0.008, 0.017))
    e = e + (t >= 0.024) * np.exp(-np.maximum(t - 0.024, 0) / 0.09) * 0.9
    noise = bp(rng.standard_normal(len(t)), 1100, 6500) * e
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.045) * 0.55 + np.sin(2 * np.pi * 330 * t) * np.exp(-t / 0.025) * 0.25
    return norm(verb(norm(noise) * 0.85 + body, wet=0.18))

HAT_F = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0]          # TR-808 metal oscillator bank
_METAL = (lambda t: hp(bp(sum(sq(f, t, 21000) for f in HAT_F), 6500, 12500), 5200))(tt(1.4))

def hat(kind="closed"):
    d, tau = {"closed": (0.07, 0.016), "open": (0.4, 0.12), "crash": (1.4, 0.5)}[kind]
    n = int(d * SR)
    t = np.arange(n) / SR
    return norm(_METAL[:n] * np.exp(-t / tau))

_cow = {}
def cowbell(f):
    if f not in _cow:
        t = tt(0.26)
        x = 0.6 * sq(f, t) + 0.4 * sq(f * 1.4815, t)          # TR-808 cowbell: two squares, ratio ~1.48
        x = bp(x, f * 0.9, min(f * 4.5, 9500))
        e = 0.72 * np.exp(-t / 0.022) + 0.28 * np.exp(-t / 0.13)
        _cow[f] = norm(np.tanh(1.8 * norm(x) * e))
    return _cow[f]

def bell(f, d=1.6, idx=2.4):
    t = tt(d)
    x = np.sin(2 * np.pi * f * t + idx * np.exp(-t / 0.3) * np.sin(2 * np.pi * 3.5 * f * t))
    return x * np.minimum(1, t / 0.003) * np.exp(-t / 0.55)

def pad(freqs, d):
    t = tt(d)
    x = np.zeros((len(t), 2))
    for f in freqs:
        for c, det in enumerate((0.994, 1.006)):
            x[:, c] += saw(f * det, t, 2500)
    a = np.minimum(1, t / 0.25) * np.clip((d - t) / 0.2, 0, 1)
    return norm(lp(x * a[:, None], 750, 2))

def riser(d):
    t = tt(d)
    p = t / d
    ph = 2 * np.pi * np.cumsum(110 * 2 ** (3 * p)) / SR
    tone = sum(np.sin(k * ph) / k for k in range(1, 7))
    air = sweep(rng.standard_normal(len(t)), lambda i: [400 + 4500 * p[i] ** 2, 900 + 6500 * p[i] ** 2], "bandpass")
    return norm((norm(tone) * 0.6 + norm(air) * 0.25) * p ** 2.6)

def impact(big=1.0):
    t = tt(1.8)
    sub = np.sin(2 * np.pi * np.cumsum(32 + 62 * np.exp(-t / 0.18)) / SR) * np.exp(-t / 0.55)
    thump = lp(rng.standard_normal(len(t)), 700, 2) * np.exp(-t / 0.035) * 0.6
    return norm(verb(np.tanh(1.5 * (sub + thump)), IR_HALL, 0.3)) * big

def rev_swell(root, d):
    """Reversed bell chord through the hall: a 'sucking' swell into a drop, no hiss."""
    ch = bell(root, 1.4) + 0.6 * bell(root * 1.5, 1.4) + 0.4 * bell(root * 2, 1.4)
    w = verb(np.concatenate([ch, np.zeros(int(1.2 * SR))]), IR_HALL, 0.85)[::-1]
    w = w[-int(d * SR):]
    w *= np.linspace(0, 1, len(w))[:, None] ** 2
    return norm(w)

def whoosh(d=0.4):
    t = tt(d)
    p = t / d
    x = sweep(rng.standard_normal(len(t)), lambda i: [250 + 2200 * p[i], 600 + 3800 * p[i]], "bandpass")
    return norm(x * np.sin(np.pi * p) ** 2)

def blip(f=1800, d=0.07):
    t = tt(d)
    return np.sin(2 * np.pi * f * t) * np.exp(-t / 0.02)

def chirp8(seed, d=0.22):
    """8-bit glitch chirp: stepped band-limited squares, no noise."""
    r = np.random.default_rng(seed)
    t = tt(d)
    steps = 6
    f = np.repeat(r.choice([523, 659, 784, 988, 1175, 1568], steps), int(np.ceil(len(t) / steps)))[:len(t)]
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = sum(np.sin(k * ph) / k for k in (1, 3, 5))
    return lp(x * np.exp(-t / 0.09), 5000)

def tick():
    t = tt(0.025)
    return bp(rng.standard_normal(len(t)), 2000, 6000) * np.exp(-t / 0.003)

def power_down(d=0.6):
    t = tt(d)
    ph = 2 * np.pi * np.cumsum(40 + 900 * np.exp(-t / 0.15)) / SR
    return lp(sum(np.sin(k * ph) / k for k in (1, 3, 5, 7)) * np.exp(-t / 0.25), 3000)

def lock_snap():
    t = tt(0.12)
    return bp(rng.standard_normal(len(t)), 1500, 5500) * np.exp(-t / 0.005) + np.sin(2 * np.pi * 2400 * t) * np.exp(-t / 0.02) * 0.5

# ------------------------------------------------------------------ musical material (F# minor, 128 BPM)
PROG = [("F#", ["F#3", "A3", "C#4"], "F#1"), ("D", ["D3", "F#3", "A3"], "D2"),
        ("E", ["E3", "G#3", "B3"], "E2"), ("C#", ["C#3", "E#3", "G#3"], "C#2")]
HOOK_STEPS = [0, 3, 6, 8, 11, 14]                       # 3-3-2 / 3-3-2 phonk rhythm
HOOK = [["C#5", "C#5", "A4", "C#5", "B4", "A4"],
        ["D5", "D5", "A4", "D5", "C#5", "A4"],
        ["E5", "E5", "B4", "E5", "D5", "B4"],
        ["G#4", "G#4", "E#4", "G#4", "C#5", "B4"]]
ARP = [["F#4", "A4", "C#5", "E5", "C#5", "A4", "F#4", "C#5"],
       ["D4", "F#4", "A4", "C#5", "A4", "F#4", "D4", "A4"],
       ["E4", "G#4", "B4", "D5", "B4", "G#4", "E4", "B4"],
       ["C#4", "E#4", "G#4", "B4", "G#4", "E#4", "C#4", "G#4"]]
KICKS = [[0, 7, 10], [0, 6, 10, 14]]

K, CL = kick(), clap()
HC, HO, CR = hat("closed"), hat("open"), hat("crash")
drums, bass, lead, keys, pads, fx = (bus() for _ in range(6))
kick_times = []

def groove_bar(t0, bi, until, energy=1):
    """One bar of the drop. energy 0 = filtered intro, 1 = drop 1, 2 = drop 2 (extra layers)."""
    name, chord, root = PROG[bi % 4]
    ok = lambda t: t < until - 0.004
    ks = KICKS[bi % 2]
    for j, st in enumerate(ks):                          # kick + 808 locked together
        t = t0 + st * S16
        if not ok(t):
            continue
        nxt = ks[j + 1] if j + 1 < len(ks) else 16
        ln = (nxt - st) * S16 * 0.95
        glide = note(root) * 2 if (bi % 2 == 1 and j == len(ks) - 1) else None
        place(drums, K, t, 1.0)
        kick_times.append(t)
        place(bass, b808(note(root), ln, glide), t + 0.004, 1.0)
    for st in (4, 12):
        if ok(t0 + st * S16):
            place(drums, CL, t0 + st * S16, 0.62)
    if bi % 4 == 3 and ok(t0 + 15 * S16):
        place(drums, CL, t0 + 15 * S16, 0.25)            # ghost
    for st in range(0, 16, 2):
        if ok(t0 + st * S16):
            place(drums, HC, t0 + st * S16, 0.16 if st % 4 == 0 else 0.11, pan=0.3)
    if bi % 2 == 1:                                      # 32nd roll on the last beat
        for j in range(8):
            t = t0 + 12 * S16 + j * S16 / 2
            if ok(t):
                place(drums, HC, t, 0.06 + 0.012 * j, pan=0.3 - 0.08 * j)
    elif bi % 4 == 2:                                    # triplet roll on beat 4
        for j in range(6):
            t = t0 + 12 * S16 + j * (B / 6)
            if ok(t):
                place(drums, HC, t, 0.09, pan=-0.25)
    if energy >= 2 or bi >= 4:
        for st in (2, 6, 10, 14):
            if ok(t0 + st * S16):
                place(drums, HO, t0 + st * S16, 0.06, pan=-0.2)
    for st, nm in zip(HOOK_STEPS, HOOK[bi % 4]):
        t = t0 + st * S16
        if ok(t):
            place(lead, cowbell(note(nm)), t, 0.55, pan=-0.12)
            place(lead, cowbell(note(nm)), t + 0.011, 0.3, pan=0.55)    # Haas width
            if energy >= 2:
                place(lead, cowbell(note(nm) * 2), t, 0.16, pan=0.2)    # octave layer in drop 2
    if bi >= 4 or energy >= 2:                           # eerie bell counter-line on the off-beats
        for j, nm in enumerate(ARP[bi % 4][1::2]):
            t = t0 + (2 + 4 * j) * S16
            if ok(t):
                place(keys, bell(note(nm), 0.9), t, 0.12, pan=0.35 if j % 2 else -0.35)
    place(pads, pad([note(n) for n in chord], max(0.05, min(4 * B, until - t0))), t0, 0.22)

# --- intro: eerie bell arpeggio + filtered teaser groove ---------------------------------------
intro = bus()
STOP = DROP - 2 * B                                       # tape-stop, then "Not here." in silence
saved = (drums, bass, lead, keys, pads)
drums = bass = lead = keys = pads = intro
for bi in range(-3, 0):
    t0 = DROP + bi * 4 * B
    groove_bar(t0, bi + 3, STOP, energy=0)
    for j, nm in enumerate(ARP[(bi + 3) % 4]):
        place(intro, bell(note(nm), 1.0) * 0.8, t0 + j * 2 * S16, 0.22, pan=-0.3 if j % 2 else 0.3)
drums, bass, lead, keys, pads = saved
kick_times.clear()
p = np.clip(np.arange(N) / (STOP * SR), 0, 1)
intro = sweep(intro, lambda i: 300 * (3600 / 300) ** (p[i] ** 1.6), "lowpass")
i0, L = int(STOP * SR), int(0.34 * SR)                     # tape stop
rate = (1 - np.arange(L) / L) ** 1.6
pos = i0 + np.cumsum(rate)
ts = np.stack([np.interp(pos, np.arange(N), intro[:, c]) for c in range(2)], 1)
intro[i0:i0 + L] = ts * np.linspace(1, 0, L)[:, None] ** 0.6
intro[i0 + L:] = 0

# --- drop 1 / break / drop 2 / end -------------------------------------------------------------
bi, t = 0, DROP
while t < BRK - 1e-6:
    groove_bar(t, bi, BRK, energy=1)
    t += 4 * B
    bi += 1
for j in range(6):                                        # 32nd clap roll into the break, after line 7 ends
    tf = BRK - (6 - j) * S16 / 2
    if tf > T["lines"][7]["end"] - 0.03:
        place(drums, CL, tf, 0.2 + 0.06 * j)
place(pads, pad([note(n) for n in PROG[0][1]], DROP2 - BRK), BRK, 0.3)
for j, nm in enumerate(ARP[0] * 3):                       # break: lonely bell arp, every 8th
    tb = BRK + j * 2 * S16
    if tb < DROP2 - 0.5:
        place(keys, bell(note(nm), 1.0), tb, 0.13, pan=-0.3 if j % 2 else 0.3)
bi, t = 0, DROP2
while t < END - 1e-6:
    groove_bar(t, bi, END, energy=2)
    t += 4 * B
    bi += 1
place(drums, CR, DROP2, 0.18, pan=0.1)
place(drums, K, END, 1.0)
kick_times.append(END)
place(bass, b808(note("F#1"), 0.9), END + 0.004, 1.0)
for nm in ("F#4", "C#5", "F#5"):
    place(keys, bell(note(nm), 1.6), END, 0.16)
place(drums, CR, END, 0.14)

# kick-keyed sidechain on pads and keys
duck = np.ones(N)
for kt in kick_times:
    i = int(kt * SR)
    n = min(int(0.25 * SR), N - i)
    if n > 0:
        duck[i:i + n] = np.minimum(duck[i:i + n], 1 - 0.6 * np.exp(-np.arange(n) / (0.06 * SR)))
pads *= duck[:, None]
keys *= (0.4 + 0.6 * duck)[:, None]

# stutter: retrigger a 1/32 slice of the groove on "snaps"
def C(key):
    """Time of a cue word: [line, word, nth occurrence, offset] from versions/<v>.json."""
    li, word, nth, off = (CUES[key] + [0, 0])[:4]
    hits = [w["s"] for w in T["lines"][li]["words"] if re.sub(r"[^a-z]", "", w["w"].lower()) == word]
    return hits[nth] + off
def stutter(at, reps=6):
    i, n = int(at * SR), int(S16 / 2 * SR)
    for b_ in (drums, bass, lead):
        sl = b_[i:i + n].copy()
        for r in range(reps):
            b_[i + r * n:i + (r + 1) * n] = sl * (1 - r / (reps + 3))
stutter(C("snaps"))

beat = hp(intro * 0.75 + drums * 0.9 + bass * 0.85 + pads * 0.7, 28)
melody = lead * 0.55 + keys * 0.8          # shares the voice's 0.4-4 kHz band -> ducked harder
music = beat + melody

# --- SFX ---------------------------------------------------------------------------------------
place(fx, impact(1.0), 0.0, 0.8)
place(fx, chirp8(1, 0.11), 0.0, 0.18)                    # ends before the first word
for k_, w in enumerate(("delete", "ban", "erase")):
    place(fx, chirp8(10 + k_), C(w), 0.16)
place(fx, riser(STOP - 1.2), 1.2, 0.35)
place(fx, rev_swell(note("F#3"), DROP - STOP - 0.05), STOP + 0.05, 0.5)
place(fx, impact(1.0), DROP, 0.95)
for i in (3, 4, 5, 6, 7):
    place(fx, whoosh(0.4), T["lines"][i]["start"] - 0.42, 0.22)   # ends before the line
place(fx, blip(1400), C("t1"), 0.2)
place(fx, blip(2100), C("t1") + 0.09, 0.16)
place(fx, tick(), C("touch") + 0.1, 0.5)
place(fx, impact(0.6), C("snaps"), 0.6)
place(fx, chirp8(21, 0.3), C("snaps"), 0.2)
place(fx, impact(0.4), C("noServer"), 0.45)
place(fx, chirp8(22), C("server"), 0.18)
place(fx, power_down(), C("down"), 0.35)
for k_ in range(5):
    place(fx, blip(1200 + 260 * k_, 0.05), T["lines"][6]["end"] + 0.02 + 0.07 * k_, 0.13)   # after the line, not on "heals"
place(fx, lock_snap(), C("lock"), 0.45)
place(fx, chirp8(23, 0.35), T["lines"][7]["end"] + 0.02, 0.16)            # after "noise", not on it
nos = [w["s"] for w in T["lines"][8]["words"] if w["w"].lower().startswith("no")]
for j, tn in enumerate(nos):
    place(fx, impact(0.85 + 0.12 * j), tn, 0.85)
place(fx, tick(), C("switch") + 0.05, 0.6)
place(fx, riser(DROP2 - 0.12 - (nos[-1] + 0.45)), nos[-1] + 0.45, 0.4)
place(fx, rev_swell(note("F#3"), 0.7), DROP2 - 0.7, 0.45)
place(fx, impact(1.1), DROP2, 0.95)
for key in ("chip0", "chip1", "chip2", "cta"):
    if key in CUES:
        place(fx, blip(1700, 0.06), C(key), 0.14)
place(fx, impact(1.2), END, 0.9)

# --- VO chain ----------------------------------------------------------------------------------
vo = np.zeros(N)
for L_ in T["lines"]:
    a, sr = sf.read(L_["file"], dtype="float64")
    a = resample_poly(a, SR, sr)
    i = int(L_["start"] * SR)
    vo[i:i + len(a)] += a[:N - i]
vo = hp(vo, 65, 2)
vo = vo + 0.35 * _f(vo, "lowpass", 170, 2, True)          # chest warmth
vo = vo + 0.18 * _f(vo, "bandpass", [1800, 4200], 2, True)  # presence
low = _f(vo, "lowpass", 5200, 4, True)                      # de-ess: zero-phase split, tame the top band
high = vo - low
env_h = np.sqrt(np.clip(uniform_filter1d(high ** 2, int(0.005 * SR)), 0, None) + 1e-12)
env_l = np.sqrt(np.clip(uniform_filter1d(low ** 2, int(0.005 * SR)), 0, None) + 1e-12)
high *= np.clip((0.35 * env_l / env_h), 0, 1) ** 0.7
vo = low + high
env = np.sqrt(np.clip(uniform_filter1d(vo ** 2, int(0.012 * SR)), 0, None) + 1e-12)   # 3:1 compressor
thr = np.percentile(env[env > 1e-3], 70)
vo = vo * np.where(env > thr, (thr / env) ** (2 / 3), 1.0)
vo = norm(vo, 0.9)
vo_st = verb(vo, IR_ROOM, 0.07)
nh = T["lines"][1]                                         # echo throw on "Not here."
i0, i1 = int(nh["start"] * SR), int((nh["end"] + 0.05) * SR)
for d, g, pan in ((0.234, 0.42, -0.6), (0.469, 0.26, 0.6), (0.703, 0.15, -0.3)):
    place(vo_st, bp(vo[i0:i1], 400, 4000) * g, nh["start"] + d, 1.0, pan=pan)

# --- mix ---------------------------------------------------------------------------------------
venv = np.sqrt(np.clip(uniform_filter1d(vo ** 2, int(0.05 * SR)), 0, None))
venv = np.clip(venv / (np.percentile(venv[venv > 1e-3], 90) + 1e-9), 0, 1)
sm = np.zeros(N)
v, a_att, a_rel = 0.0, np.exp(-64 / (0.015 * SR)), np.exp(-64 / (0.3 * SR))
for i in range(0, N, 64):
    x = venv[i]
    c = a_att if x > v else a_rel
    v = c * v + (1 - c) * x
    sm[i:i + 64] = v
duck_beat = 10 ** (-4.5 * sm / 20)                         # duck the beat 4.5 dB under the voice...
duck_mel = 10 ** (-9.0 * sm / 20)                          # ...and the cowbell/bells 9 dB, to keep consonants clear
duck_fx = 10 ** (-6.0 * sm / 20)
pre = beat * duck_beat[:, None] + melody * duck_mel[:, None] + fx * duck_fx[:, None] * 0.8 + vo_st * 1.5
fo = int((DUR - 0.5) * SR)
pre[fo:] *= np.linspace(1, 0, N - fo)[:, None] ** 1.5

def limiter(x, ceiling, look=0.005, release=0.08):
    """Lookahead peak limiter: windowed minimum of the needed gain, smoothed (never above what any
    sample in the window needs), with one-pole release."""
    L_ = int(look * SR)
    need = np.minimum(1.0, ceiling / np.maximum(np.max(np.abs(x), 1), 1e-9))
    g = uniform_filter1d(minimum_filter1d(need, 2 * L_ + 1), L_)
    out = np.empty_like(g)
    r = np.exp(-1 / (release * SR))
    cur = 1.0
    for i in range(len(g)):
        cur = g[i] if g[i] < cur else r * cur + (1 - r) * g[i]
        out[i] = cur
    return x * out[:, None], out

meter = pyln.Meter(SR)
pre_l = meter.integrated_loudness(pre)
print(f"pre-master: {pre_l:.1f} LUFS, peak {20*np.log10(np.max(np.abs(pre))):.1f} dBFS")
mix = pre * 10 ** ((LUFS_TARGET - pre_l) / 20)
for _ in range(2):                                         # limit, re-measure, nudge
    lim, g = limiter(mix, CEILING)
    mix = mix * 10 ** ((LUFS_TARGET - meter.integrated_loudness(lim)) / 20)
lim, g = limiter(mix, CEILING)
gr = -20 * np.log10(g)
print(f"master: {meter.integrated_loudness(lim):.1f} LUFS, peak {20*np.log10(np.max(np.abs(lim))):.2f} dBFS, "
      f"max GR {gr.max():.1f} dB, GR>2dB on {100*np.mean(gr > 2):.1f}% of samples")
sf.write(f"build/{V}/mix.wav", lim.astype(np.float32), SR, subtype="PCM_24")
sf.write(f"build/{V}/music_only.wav", norm(music * 0.8 + fx * 0.6, 0.9).astype(np.float32), SR, subtype="PCM_24")
sf.write(f"build/{V}/vo_only.wav", norm(vo_st, 0.9).astype(np.float32), SR, subtype="PCM_24")
