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
def cowbell(semi,dur=.22,amp=1.0):
    n=int(dur*SR); t=np.arange(n)/SR; r=2**(semi/12)
    x=sq(540*r,n)+sq(800*r,n)*.9
    x=bp(x,500*r,3200*r)*np.exp(-t*15)*env(n,.001,.03)
    return np.tanh(x*1.6)*.33*amp
def b808(semi,dur,amp=1.0):
    n=int(dur*SR); t=np.arange(n)/SR; f=87.31*2**(semi/12)
    x=sine(f*(1+.6*np.exp(-t*45)),n)*np.exp(-t*1.9)
    x=np.tanh(x*3.2)*.8+np.tanh(x*9)*.2
    return lp(x,1800)*env(n,.002,.04)*amp
def pkick():
    n=int(.3*SR); t=np.arange(n)/SR
    x=sine(50+170*np.exp(-t*42),n)*np.exp(-t*11)+.5*hp(rs.randn(n),2500)*np.exp(-t*260)
    return np.tanh(x*2.6)*env(n,.001,.04)
def crash(dur=1.6):
    n=int(dur*SR); t=np.arange(n)/SR; x=np.stack([rs.randn(n),rs.randn(n)],1); return hp(x,5000)*np.exp(-t*3.2)[:,None]*.3
RIFA=[0,None,0,None, 3,None,0,None, 7,None,5,None, 3,None,0,-2]
RIFB=[0,None,0,None, 3,None,0,None, 8,None,7,None, 5,3,0,None]
B808=[(0,0,3),(3,0,3),(6,0,4),(10,-2,2),(12,3,2),(14,-2,2)]
riff=buf(); low=buf(); drm=buf(); fxb=buf(); them=buf()
def bar_riff(b,dest,amp=1.0,octave=12):
    pat=RIFA if b%2==0 else RIFB
    for s,nn in enumerate(pat):
        if nn is None: continue
        c=cowbell(nn+octave,amp=amp); add(dest,c,b*BARL+s*ST,1,(-1)**s*.25)
def bar_full(b,last=False):
    t0=b*BARL
    bar_riff(b,riff)
    for s,nn,ln in B808:
        if last and s>=10: continue
        add(low,b808(nn,ln*ST*1.15),t0+s*ST,.95)
    for s in (0,6,10): 
        if not (last and s>=10): add(drm,pkick(),t0+s*ST,1.0)
    for s in (4,12): add(drm,clap(),t0+s*ST,1.3,.05); add(drm,hp(rs.randn(int(.12*SR)),1800)*np.exp(-np.arange(int(.12*SR))/SR*30)*.25,t0+s*ST,1)
    for s in range(16):
        if s%2==0: add(drm,hat(),t0+s*ST,.9,.3)
        elif rs.rand()<.5: add(drm,hat(),t0+s*ST,.45,-.3)
    if b%2==1:
        for k_ in range(6): add(drm,hat(),t0+14*ST+k_*ST/3,.4+.1*k_,.5-.2*k_)
    else: add(drm,hat(True),t0+14*ST,.8,.2)
def bar_them(b):
    t0=b*BARL; bar_riff(b,them,amp=.8,octave=0)
    add(drm,pkick(),t0,.55); add(drm,pkick(),t0+8*ST,.4)
    add(fxb,powerdown(.5),t0,.35)
    n=int(BARL*SR); add(them,(lp(rs.randn(n),2500)*.012*(rs.rand(n)>.7)),t0,1)     # vinyl crackle
def drop(b,g=1.0):
    t0=b*BARL; add(low,impact(2.5,70),t0,.9*g); add(fxb,crash(),t0,1.0*g)
# intro: filtered riff, vinyl, riser
for b in (0,1): bar_riff(b,them,amp=.9,octave=0)
n=int(2*BARL*SR); add(them,lp(rs.randn(n),2500)*.014*(rs.rand(n)>.7),0,1)
add(fxb,riser(BARL,250,11000,tone=53),BARL,.9)
for k_ in range(8): add(drm,clap(),2*BARL-BT+k_*BT/8,.3+.6*k_/8)
drop(2); bar_full(2)
for p_ in range(NP):
    bt_,bu=3+p_*2,4+p_*2
    bar_them(bt_); add(fxb,riser(BT*1.5,400,10000),bu*BARL-BT*1.5,.6)
    for k_ in range(4): add(drm,clap(),bu*BARL-BT/2+k_*BT/8,.4+.2*k_)
    drop(bu); bar_full(bu)
bo=3+NP*2
drop(bo); bar_full(bo); drop(bo+1,.8); bar_full(bo+1); bar_full(bo+2,last=True)
endt=(bo+2)*BARL+10*ST
for m_ in (41,53,56,60): 
    p=pad_note(m_,1.2,fc=1800,a=.01,r=1.6); add(riff,p,endt,.5)
add(low,impact(3,60),endt,.8)
# dark pad under everything after the drop
for b in range(2,bo+3):
    for m_ in (41,48,53,56): p=pad_note(m_,BARL,fc=700,a=.05,r=.3); add(low,p*.0+0,b*BARL,0)
themf=lp(them,650)
kenv=np.ones(N)
riffv=riff+reverb(riff,1.6,5000)*.22
mix=np.tanh((riffv*3.4+low*.5+lp(drm,200)*.8+hp(drm,200)*2.0+fxb*.8)*1.3)*.8+themf*2.2+reverb(themf,2.2,1500,seed=4)*.5
mix=hp(mix,30)
fo=int(.7*SR); mix[-fo:]*=np.linspace(1,0,fo)[:,None]
pk=np.abs(mix).max(); mix*=.92/pk
sf.write(OUT,mix,SR,subtype='PCM_24'); print('peak',pk,'rms',np.sqrt((mix**2).mean()),'dur',DUR)
