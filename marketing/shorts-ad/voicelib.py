import numpy as np
def f0(a, sr):
    """Median pitch of voiced frames via normalised autocorrelation."""
    fr, hop = int(0.04*sr), int(0.01*sr); out = []
    for i in range(0, len(a)-fr, hop):
        x = a[i:i+fr] * np.hanning(fr)
        if np.sqrt(np.mean(x**2)) < 0.02: continue
        ac = np.correlate(x, x, 'full')[fr-1:]
        lo, hi = int(sr/300), int(sr/60)
        j = lo + np.argmax(ac[lo:hi])
        if ac[j] > 0.45*ac[0]: out.append(sr/j)
    return float(np.median(out)) if out else 0.0
