import numpy as np, json, sys
from scipy import signal
import soundfile as sf
SR=44100
CUE=json.load(open(sys.argv[1])); OUT=sys.argv[2]
DUR=CUE['END']+1.0; N=int(DUR*SR)
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

def hit(t,g=1.0,ch=None,bright=1.0):
    add(sub,impact(3.5,64),t,1.0*g); add(wet,impact(1.5,90,2.2*bright),t,.4*g)
    c=CH[chord_at(t)] if ch is None else ch
    for m in c:
        for o in (0,12,24):
            p=pad_note(m+o,1.2,fc=4200*bright,a=.004,r=1.6); add(dry,p,t,.3*g); add(wet,p,t,.45*g)

# ---------- groove sections ----------
ARP=[0,1,2,1,0,2,1,2]
def groove(t0,t1,kick_on=True,hats=True,claps=True,arp=True,bass=True,padg=.3,lead=False,arp_oct=24,half=False,g=1.0):
    nb=int(round((t1-t0)/BEAT))
    for i in range(nb):
        t=t0+i*BEAT; ci=chord_at(t+1e-6); c=CH[ci]; bi=int(round((t%BAR)/BEAT))
        if kick_on and (not half or bi%2==0): add(drums,kick(1.0),t,g)
        if claps and bi%2==1: add(drums,clap(),t,.8*g,.1); 
        if hats:
            add(drums,hat(),t+.25,.9*g,.25); add(drums,hat(),t+.125,.35*g,-.3); add(drums,hat(),t+.375,.35*g,.4)
            if bi==3: add(drums,hat(True),t+.25,.5*g,.2)
        if bass:
            for s in (0,.25):
                if half and s>0: continue
                add(sub,bass_note(ROOT[ci]+(12 if (s>0 and bi%2==1) else 0),.22 if not half else .45),t+s,.62*g)
        if arp:
            for s in range(4):
                j=(i*4+s)
                m=c[ARP[j%8]]+arp_oct+(12 if j%16>=12 else 0)
                p=pluck(m,.35,3800 if not lead else 5000,11); add(dry,p,t+s*.125,.2*g,np.sin(j*.9)*.6); add(dly,p,t+s*.125,.16*g)
    # pads per bar
    b=t0
    while b<t1-1e-6:
        e=min(t1,(np.floor(b/BAR+1e-6)+1)*BAR); c=CH[chord_at(b+1e-6)]
        for m in c+[c[0]+12]:
            p=pad_note(m+12,e-b,fc=1900,a=.08,r=.5); add(wet,p,b,padg*g); add(dry,p,b,padg*.5*g)
        b=e
MEL=[[(0,77),(1,76),(1.5,74),(2.5,69)],[(0,77),(1,76),(1.5,74),(2.5,70)],[(0,81),(1,79),(1.5,77),(2.5,72)],[(0,79),(1,77),(1.5,76),(2.5,72),(3,74),(3.5,76)]]
def lead(t0,t1,g=1.0):
    b=np.floor(t0/BAR)*BAR
    while b<t1-1e-6:
        for (bt,m) in MEL[chord_at(b+1e-6)]:
            t=b+bt*BEAT
            if t>=t0-1e-6 and t<t1-.2:
                n=int(.9*SR); tt=np.arange(n)/SR; f=mtof(m)*(1+.004*np.sin(2*np.pi*5.5*tt)*np.minimum(1,tt*3))
                x=(saw(f,n)*.5+sine(f,n)+.4*sq(f*2,n)); x=lp(x,3000)*env(n,.012,.35)*np.exp(-tt*1.2)*.3
                add(dry,x,t,.55*g); add(dly,x,t,.35*g); add(wet,x,t,.5*g)
                bb=bell(m+12,1.5); add(wet,bb,t,.25*g); add(dry,bb,t,.12*g)
        b+=BAR


# --- short arrangement ---
n2=int(K['kill']*SR); t2=np.arange(n2)/SR
dr=np.stack([lp(saw(mtof(26)*1.002,n2)+saw(mtof(26)*.997,n2),160),lp(saw(mtof(26)*.998,n2)+saw(mtof(26)*1.004,n2),160)],1)*(np.minimum(1,t2/1.0))[:,None]*.5
add(sub,dr,0)
for m_,a in ((50,.9),(53,.7),(57,.6),(52,.35)): add(wet,pad_note(m_,K['kill']-.4,fc=800,a=.6,r=.3),0,a*.5)
for i in range(int(K['kill']/BEAT)):
    t=i*BEAT
    if i%2==0: add(drums,kick(.6),t); add(drums,kick(.4),t+.18)
    add(drums,hat(),t+.25,.5,.3); add(drums,hat(),t+.125,.3,-.3)
for i in range(2):
    t=K['ad']+i*.22; nn=int(.16*SR); x=(sine(1318.5,nn)+sine(1976,nn)*.6)*env(nn,.002,.1)*.22; add(dry,x,t,1,(-1)**i*.5); add(dly,x,t,.5)
add(sfx,riser(min(2.5,K['kill']-.2),200,7000,tone=50),K['kill']-min(2.5,K['kill']-.2),.9)
add(sfx,click(),K['kill']-.02,1.6); add(sfx,powerdown(1.0),K['kill']+.02,.9); add(sub,impact(3,70),K['kill'],1.2); add(sfx,glitch(.4),K['kill']+.02,.8)
b=bell(74,2); add(dry,b,K['B']+.05,.5); add(dly,b,K['B']+.05,.6); add(wet,b,K['B']+.05,.7)
hit(K['logo'],1.0,[50,54,57])
for i,m_ in enumerate([74,78,81,86,81,78,74,78,81,86,90,86]):
    t=K['logo']+i*.125
    if t<K['C']-.05: p=pluck(m_,.5,4500); add(dry,p,t,.28,(-1)**i*.5); add(dly,p,t,.4)
tp=K['post']; to=K['offTry']; tend=K['END']-2.5
add(sfx,whoosh(.5),K['C']-.3,.8)
groove(K['C'],tp,kick_on=True,hats=True,claps=False,arp=True,padg=.3,g=.9)
add(sfx,click(),tp-.02,1.6); b=bell(86,2.5); add(dry,b,tp+.1,.6); add(wet,b,tp+.1,.8)
groove(tp,K['D'],padg=.32); lead(tp,K['D'],.8)
hit(K['D'],.8); groove(K['D'],to,padg=.32); lead(K['D'],to,.85)
add(sfx,click(),to-.02,1.6); add(sfx,powerdown(.4),to+.02,.55)
nn=int(.3*SR); kk=np.arange(nn)/nn; boing=sine(300*2**(kk*1.7),nn)*env(nn,.005,.08)*.3; add(dry,boing,to+.38,1); add(dly,boing,to+.38,.5)
hit(to+.5,1.0,bright=1.4)
groove(to+1.0,tend,padg=.36,g=1.0); lead(to+1.0,tend,1.0)
hit(K['G'],.9,bright=1.4)
hit(tend,1.0,[50,54,57],bright=1.4)
for m_ in (38,50,57,62,66,69,74):
    p=pad_note(m_,2.2,fc=2400,a=.02,r=1.8); add(wet,p,tend,.3); add(dry,p,tend,.15)
for i,m_ in enumerate([74,78,81,86,90,93]): b=bell(m_,3); add(dry,b,tend+i*.125,.3,(-1)**i*.5); add(wet,b,tend+i*.125,.5)
tl=to+1.0
# ---------- sidechain + mix ----------
kt=np.zeros(N)
def sc_env(times):
    e=np.ones(N)
    for t in times:
        i=int(t*SR); n=int(.28*SR)
        if i<N: 
            n=min(n,N-i); e[i:i+n]=np.minimum(e[i:i+n],.35+.65*(np.arange(n)/int(.28*SR))**1.5)
    return e
# detect kick times from drums bus energy below 90 Hz is overkill: recompute known grid
kts=[]
def gk(t0,t1,half=False):
    nb=int(round((t1-t0)/BEAT))
    for i in range(nb):
        t=t0+i*BEAT; bi=int(round((t%BAR)/BEAT))
        if not half or bi%2==0: kts.append(t)
gk(K['C'],to); gk(to+1,tend)
e=sc_env(kts)[:,None]
music=(dry*1.7+dly*1.5+delay(dly,.375,.5,6)*1.5)*e + (reverb(wet+dry*.3+dly*.6+sfx*.35,3.0,5200)*.75)*(.5+.5*e) + sub*(.6+.4*e)*.5
music=hp(music,28)
mix=music*.9+lp(drums,150)*.6+hp(drums,150)*1.25+reverb(drums,.9,6000,seed=3)*.08+sfx*.8
mix=mix+hp(mix,4500)*.9   # air shelf
# master: gentle glue + soft clip
mix=np.tanh(mix*.8)/np.tanh(.8)*.8
fo=int(1.6*SR); mix[-fo:]*=np.linspace(1,0,fo)[:,None]**1.5
pk=np.abs(mix).max(); mix*=.89/pk
sf.write(OUT,mix,SR,subtype='PCM_24'); print('peak',pk,'rms',np.sqrt((mix**2).mean()),'dur',DUR)
