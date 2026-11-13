import numpy as np, json, sys
from scipy import signal
import soundfile as sf
SR=44100
CUE=json.load(open(sys.argv[1])); OUT=sys.argv[2]
DUR=CUE['END']; N=int(DUR*SR)
rs=np.random.RandomState(7)
def mtof(m): return 440*2**((m-69)/12)
def buf(): return np.zeros((N,2))
def add(b,x,t,gain=1.0,pan=0.0):
    i=int(t*SR)
    if i>=N: return
    if x.ndim==1:
        l=np.cos((pan+1)*np.pi/4)*1.414; r=np.sin((pan+1)*np.pi/4)*1.414
        x=np.stack([x*l,x*r],1)
    n=min(len(x),N-i); b[i:i+n]+=x[:n]*gain
def env(n,a=.005,r=.05):
    e=np.ones(n); na=max(1,int(a*SR)); nr=max(1,int(r*SR))
    na=min(na,n); nr=min(nr,n)
    e[:na]*=np.linspace(0,1,na); e[-nr:]*=np.linspace(1,0,nr); return e
def saw(f,n,ph=0.0):
    t=np.arange(n)/SR
    if np.isscalar(f): p=f*t+ph
    else: p=np.cumsum(f)/SR+ph
    return 2*(p%1)-1
def sq(f,n): return np.sign(saw(f,n))
def sine(f,n,ph=0):
    if np.isscalar(f): return np.sin(2*np.pi*(f*np.arange(n)/SR)+ph)
    return np.sin(2*np.pi*np.cumsum(f)/SR+ph)
def lp(x,fc,order=2): return signal.sosfilt(signal.butter(order,min(fc,SR*.45),'low',fs=SR,output='sos'),x,axis=0)
def hp(x,fc,order=2): return signal.sosfilt(signal.butter(order,fc,'high',fs=SR,output='sos'),x,axis=0)
def bp(x,f1,f2): return signal.sosfilt(signal.butter(2,[f1,f2],'band',fs=SR,output='sos'),x,axis=0)
def sweep_lp(x,f0,f1,chunks=48):
    # crude time-varying lowpass: crossfaded chunks
    n=len(x); out=np.zeros_like(x); edges=np.linspace(0,n,chunks+1).astype(int)
    for k in range(chunks):
        fc=f0*(f1/f0)**(k/(chunks-1)); y=lp(x,fc)
        a,b=edges[k],edges[k+1]; w=np.zeros(n); w[a:b]=1
        ov=min(400,a, n-b) if k>0 and k<chunks-1 else 0
        out[a:b]+=y[a:b]
    return out
def reverb(x,secs=2.8,damp=3500,pre=.02,seed=1):
    r=np.random.RandomState(seed); n=int(secs*SR); t=np.arange(n)/SR
    ir=r.randn(n,2)*np.exp(-t*6.9/secs)[:,None]; ir=lp(ir,damp); ir[:int(pre*SR)]=0; ir/=np.sqrt((ir**2).sum(0)).max()
    return np.stack([signal.fftconvolve(x[:,c],ir[:,c])[:len(x)] for c in range(2)],1)
def delay(x,dt,fb=.45,taps=6,ping=True):
    out=np.zeros_like(x); d=int(dt*SR)
    for k in range(1,taps+1):
        y=np.zeros_like(x); 
        if k*d>=len(x): break
        y[k*d:]=x[:-k*d]*fb**k
        if ping and k%2==1: y=y[:,::-1]
        out+=y
    return out

BEAT=.5; BAR=2.0
CH=[[50,53,57],[46,50,53],[53,57,60],[48,52,55]]   # Dm Bb F C (midi, around D3)
ROOT=[38,34,41,36]
def chord_at(t): return int(t//BAR)%4

# ---------- instruments ----------
def pad_note(m,dur,fc=1400,a=.6,r=1.0):
    n=int((dur+r)*SR); f=mtof(m); out=np.zeros((n,2))
    for c,sgn in ((0,-1),(1,1)):
        for d in (-9,0,8):
            out[:,c]+=saw(f*2**((d+sgn*3)/1200),n,rs.rand())
    out=lp(out,fc,2)*env(n,a,r)[:,None]; return out/6
def bass_note(m,dur,fc=420):
    n=int(dur*SR); f=mtof(m); t=np.arange(n)/SR
    x=.6*saw(f,n)+.4*sq(f*1.003,n); x=lp(x,fc+900*np.exp(-t*14).mean(),2)
    x=lp(x*1,fc*2)*.55+sine(f,n)*.75
    return np.tanh(x*1.4)*env(n,.004,.04)*(.75+.25*np.exp(-t*6))
def pluck(m,dur=.5,fc=3200,decay=9):
    n=int(dur*SR); f=mtof(m); t=np.arange(n)/SR
    x=saw(f,n)+.5*sq(f*2.005,n)+.5*saw(f*1.006,n)
    x=lp(x,fc)*np.exp(-t*decay)*env(n,.002,.02); return x*.4
def bell(m,dur=2.5):
    n=int(dur*SR); f=mtof(m); t=np.arange(n)/SR
    x=sine(f,n)*np.exp(-t*2.2)+.5*sine(f*2.01,n)*np.exp(-t*3.5)+.25*sine(f*3.98,n)*np.exp(-t*6)+.12*sine(f*5.4,n)*np.exp(-t*9)
    return x*env(n,.002,.05)*.5
def keys(m,dur=3.0):
    n=int(dur*SR); f=mtof(m); t=np.arange(n)/SR
    x=sum(sine(f*k*(1+.0004*k*k),n)*np.exp(-t*(1.2+k*.9))/k for k in range(1,7))
    return lp(x,2600)*env(n,.004,.1)*.5
def kick(amp=1):
    n=int(.42*SR); t=np.arange(n)/SR
    f=46+110*np.exp(-t*34); x=sine(f,n)*np.exp(-t*8.5); x+=.35*hp(rs.randn(n),3000)*np.exp(-t*220)
    return np.tanh(x*1.8)*amp*env(n,.001,.05)
def clap():
    n=int(.3*SR); t=np.arange(n)/SR; x=bp(rs.randn(n),900,4200)
    e=np.exp(-t*24)+.7*np.exp(-np.abs(t-.012)*400)+.7*np.exp(-np.abs(t-.024)*400); return x*e*.5
def hat(open_=False):
    n=int((.25 if open_ else .06)*SR); t=np.arange(n)/SR
    return hp(rs.randn(n),7500)*np.exp(-t*(16 if open_ else 70))*.36
def impact(dur=4.0,f0=62,bright=1.0):
    n=int(dur*SR); t=np.arange(n)/SR
    x=sine(26+f0*np.exp(-t*5),n)*np.exp(-t*1.6)*1.1
    x+=lp(rs.randn(n),1800*bright)*np.exp(-t*7)*.7+lp(rs.randn(n),300)*np.exp(-t*1.4)*.5
    return np.tanh(x*1.5)*env(n,.001,.3)
def riser(dur,f0=300,f1=9000,tone=None):
    n=int(dur*SR); t=np.arange(n)/SR; k=t/dur
    x=np.stack([rs.randn(n),rs.randn(n)],1); out=np.zeros_like(x); ch=40; e=np.linspace(0,n,ch+1).astype(int)
    for i in range(ch):
        fc=f0*(f1/f0)**(i/(ch-1)); y=bp(x,fc*.7,min(fc*1.4,SR*.45)); out[e[i]:e[i+1]]=y[e[i]:e[i+1]]
    out*= (k**2.2)[:,None]*.6
    if tone: out+= (sine(mtof(tone)*2**(k*1.0),n)*k**2*.12)[:,None]
    return out*env(n,.01,.01)[:,None]
def whoosh(dur=.7):
    n=int(dur*SR); k=np.arange(n)/n; x=np.stack([rs.randn(n),rs.randn(n)],1)
    out=np.zeros_like(x); ch=24; e=np.linspace(0,n,ch+1).astype(int)
    for i in range(ch):
        kk=i/(ch-1); fc=400+5000*np.sin(kk*np.pi); y=bp(x,fc*.6,fc*1.5); out[e[i]:e[i+1]]=y[e[i]:e[i+1]]
    return out*(np.sin(k*np.pi)**2)[:,None]*.35
def click():
    n=int(.03*SR); t=np.arange(n)/SR; return (sine(2400,n)*np.exp(-t*300)+.6*hp(rs.randn(n),4000)*np.exp(-t*500))*.5
def powerdown(dur=1.6):
    n=int(dur*SR); k=np.arange(n)/n; f=220*np.exp(-k*3.6)+18
    x=saw(f,n)*.5+sq(f*.5,n)*.4; x=sweep_lp(x,3000,120,32); return x*(1-k)**.7*.7
def glitch(dur=.5):
    n=int(dur*SR); x=np.zeros(n); seg=int(.03*SR)
    for i in range(0,n-seg,seg):
        if rs.rand()<.7: f=rs.choice([110,220,880,1760,3520,55]); x[i:i+seg]=sq(f,seg)*rs.rand()
    x+=hp(rs.randn(n),5000)*(rs.rand(n)>.6)*.5
    return x*np.linspace(1,.2,n)*.35

dry=buf(); wet=buf(); dly=buf(); drums=buf(); sub=buf(); sfx=buf()
K=CUE



BPM=CUE['bpm']; BT=60/BPM; ST=BT/4; BARL=BT*4; NP=CUE['pairs']
ROOT=554.37   # cowbell fundamental pair (540/800) = tonic; melody moves in a minor scale around it
def cowbell(semi,dur=.34,amp=1.0):
    n=int(dur*SR); t=np.arange(n)/SR; r=2**(semi/12)
    x=sq(ROOT*r,n)*.9+sq(ROOT*1.4815*r,n)
    x=bp(x,380*r,2600*r)
    e=.75*np.exp(-t*38)+.3*np.exp(-t*7.5)
    return np.tanh(x*e*2.4)*.42*amp*env(n,.0008,.03)
def b808(semi,dur,amp=1.0,glide=0):
    n=int(dur*SR); t=np.arange(n)/SR; f0=69.30*2**(semi/12)
    f=f0*(1+.9*np.exp(-t*55))*2**(glide*np.minimum(1,t/dur*1.6)/12)
    x=sine(f,n)+.5*sine(f*2,n)
    x=np.tanh(x*np.exp(-t*1.4)*4.5)                      # hard saturation -> harmonics audible on phones
    x=lp(x,2200)+.25*bp(np.tanh(x*3),600,1800)
    return x*env(n,.002,.05)*amp*.6
def pkick():
    n=int(.34*SR); t=np.arange(n)/SR
    x=sine(48+190*np.exp(-t*48),n)*np.exp(-t*9)+.6*hp(rs.randn(n),3000)*np.exp(-t*300)
    return np.tanh(x*3.0)*env(n,.0008,.05)
def snare():
    n=int(.28*SR); t=np.arange(n)/SR
    x=bp(rs.randn(n),700,6000)*(np.exp(-t*22)+.6*np.exp(-np.abs(t-.011)*500)+.5*np.exp(-np.abs(t-.022)*500))+sine(190,n)*np.exp(-t*30)*.5
    return np.tanh(x*1.6)*.55
def chat(open_=False,amp=1.0):
    n=int((.3 if open_ else .05)*SR); t=np.arange(n)/SR
    x=sum(sq(f_,n) for f_ in (3263,4117,5481,6827,8432,9713))/6
    return hp(x+rs.randn(n)*.6,6500)*np.exp(-t*(11 if open_ else 85))*.28*amp
def crash(dur=1.8):
    n=int(dur*SR); t=np.arange(n)/SR; x=np.stack([rs.randn(n),rs.randn(n)],1); return hp(x,4500)*np.exp(-t*2.8)[:,None]*.3
def revcrash(dur):
    n=int(dur*SR); k=np.arange(n)/n; x=np.stack([rs.randn(n),rs.randn(n)],1); return hp(x,3500)*(k**3)[:,None]*.32
def choir(m,dur,amp=1.0):
    # dark "ahh" pad: detuned saws through two vowel formants
    n=int((dur+.4)*SR); f=mtof(m); out=np.zeros((n,2))
    for c,sg in ((0,-1),(1,1)):
        x=sum(saw(f*2**((d+sg*4)/1200),n,rs.rand()) for d in (-11,0,9))
        out[:,c]=bp(x,600,1000)*1.0+bp(x,1000,1400)*.6+lp(x,350)*.4
    return out*env(n,.25,.4)[:,None]*.09*amp
# 4-bar minor riff (semitones from tonic), 16 steps per bar
R=[[0,0,None,0, None,3,None,0, 0,None,7,None, 5,None,3,None],
   [0,0,None,0, None,3,None,0, 0,None,8,None, 7,None,5,3],
   [0,0,None,0, None,3,None,0, 0,None,7,None, 5,None,3,None],
   [0,0,None,0, None,3,None,0, 10,None,8,None, 7,5,3,2]]
B=[[(0,0,7,0),(8,0,3,0),(11,3,3,0),(14,-2,2,2)],
   [(0,0,7,0),(8,0,3,0),(11,-4,3,0),(14,-2,2,0)]]
KICK=[0,3,8,11]; SN=[4,12]
riff=buf(); low=buf(); kik=buf(); drm=buf(); fxb=buf(); pad=buf(); ducks=[]
def bar_riff(b,amp=1.0,oct_up=True):
    for s,nn in enumerate(R[b%4]):
        if nn is None: continue
        t=b*BARL+s*ST; acc=1.0 if s%4==0 else .85
        add(riff,cowbell(nn,amp=amp*acc),t,1,-.12)
        if oct_up: add(riff,cowbell(nn+12,dur=.2,amp=amp*.22),t,1,.3)
def bar_low(b,stop=16):
    for s,nn,ln,gl in B[b%2]:
        if s>=stop: continue
        add(low,b808(nn,ln*ST*1.2,glide=gl),b*BARL+s*ST,1)
def bar_drums(b,stop=16,roll=False):
    t0=b*BARL
    for s in KICK:
        if s<stop: add(kik,pkick(),t0+s*ST,1); ducks.append(t0+s*ST)
    for s in SN:
        if s<stop: sn=snare(); add(drm,sn,t0+s*ST,1.0,.05)
    for s in range(0,min(stop,16),2): add(drm,chat(),t0+s*ST,1.0 if s%4==0 else .7,.35)
    if stop>=16:
        add(drm,chat(True),t0+6*ST,.7,.2)
        if roll:
            for k_ in range(6): add(drm,chat(amp=.5+.1*k_),t0+13*ST+k_*ST/2,1,.5-.2*k_)
        else: add(drm,chat(True),t0+14*ST,.8,.2)
def bar_pad(b,amp=1.0):
    for m_ in ((49,56,61,64) if b%2==0 else (45,57,61,64)): add(pad,choir(m_,BARL,amp),b*BARL,1)
def drop(b,g=1.0):
    t0=b*BARL; add(fxb,impact(2.5,70)[:,None]*np.ones((1,2)),t0,.7*g); add(fxb,crash(),t0,1.0*g)
    add(fxb,revcrash(BT*2),t0-BT*2,.9*g)
THEM=[0,1]+[3+2*i for i in range(NP)]
bo=3+NP*2; LAST=bo+2
for b in range(0,LAST+1):
    last=b==LAST
    bar_riff(b); bar_pad(b)
    if b in THEM:
        # groove keeps moving underneath: kick on every beat, sub on the root
        for q in range(4): add(kik,pkick(),b*BARL+q*BT,.9); ducks.append(b*BARL+q*BT)
        add(low,b808(0,BT*3.6),b*BARL,.6)
        if b>=2: add(fxb,powerdown(.55)[:,None]*np.ones((1,2)),b*BARL,.35)
        if b!=0:
            for k_ in range(8): add(drm,snare(),(b+1)*BARL-BT+k_*BT/8,.25+.6*k_/8)     # snare build into the drop
    else:
        bar_low(b,stop=10 if last else 16); bar_drums(b,stop=10 if last else 16,roll=(b%2==0))
        if b-1 in THEM or b==2: drop(b)
endt=LAST*BARL+10*ST
add(fxb,impact(3,60)[:,None]*np.ones((1,2)),endt,.8); add(riff,cowbell(0,dur=1.2,amp=1.1),endt,1); add(riff,cowbell(7,dur=1.2,amp=.7),endt,1)
# ---- bus processing ----
# sidechain pump from the kick
pump=np.ones(N); nd=int(.22*SR); shape=.3+.7*(np.arange(nd)/nd)**1.3
for t in ducks:
    i=int(t*SR)
    if i<N: m_=min(nd,N-i); pump[i:i+m_]=np.minimum(pump[i:i+m_],shape[:m_])
pump=pump[:,None]
# section mask: on THEM bars the top end is rolled off (filter dip), full range elsewhere
mask=np.ones(N)
for b in THEM:
    a,e=int(b*BARL*SR),min(N,int((b+1)*BARL*SR)); mask[a:e]=0
mask=signal.sosfiltfilt(signal.butter(1,25,'low',fs=SR,output='sos'),mask)[:,None]
riffw=riff+delay(riff,BT*.75,.32,3)*.35; riffw=riffw+reverb(riffw,1.4,4500)*.2; riffw=riffw*1.9
music_hi=(riffw*1.0)*(.55+.45*pump)+pad*(.4+.6*pump)*.6+drm*1.35
music_lo=hp(np.tanh(low*(.25+.75*pump)*1.2)*.36,36)+kik*.7
full=music_hi+music_lo+fxb*.75
dull=lp(music_hi,750)*.95+lp(music_lo,220)*.9+lp(fxb,1500)*.6+reverb(lp(riffw,750),2.0,1200,seed=4)*.5
mix=full*mask+dull*(1-mask)
mix=hp(mix,28)
mix=np.tanh(mix*.95)/np.tanh(.95)*.8
fo=int(.7*SR); mix[-fo:]*=np.linspace(1,0,fo)[:,None]
pk=np.abs(mix).max(); mix*=.92/pk
sf.write(OUT,mix,SR,subtype='PCM_24'); print('peak',pk,'rms',np.sqrt((mix**2).mean()),'dur',DUR)
