import numpy as np, json, sys
from scipy import signal
import soundfile as sf
SR=44100
CUE=json.load(open(sys.argv[1])); OUT=sys.argv[2]
DUR=CUE['END']+2.5; N=int(DUR*SR)
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

# ---------- A1: warm, the group you love ----------
ta2=K['a2']
for m_,a in ((53,.8),(57,.7),(60,.7),(64,.4),(41,.6)): add(wet,pad_note(m_+12,ta2-.2,fc=1500,a=1.2,r=1.5),.1,a*.22); 
for t,m_ in ((.6,72),(1.1,77),(1.6,81),(2.35,79),(2.85,77),(3.6,84),(4.1,81)):
    if t<ta2-.3:
        k_=keys(m_); add(dry,k_,t,.5,rs.uniform(-.4,.4)); add(wet,k_,t,.6); add(dly,k_,t,.25)
# ---------- A2: it belongs to a company ----------
n2=int((K['kill']-ta2)*SR); t2=np.arange(n2)/SR
dr=np.stack([lp(saw(mtof(26)*1.002,n2)+saw(mtof(26)*.997,n2),160),lp(saw(mtof(26)*.998,n2)+saw(mtof(26)*1.004,n2),160)],1)*(np.minimum(1,t2/1.5))[:,None]*.5
add(sub,dr,ta2)
for m_,a in ((50,.9),(53,.7),(57,.6),(52,.35)): add(wet,pad_note(m_,K['kill']-ta2-.6,fc=750,a=1.0,r=.3),ta2,a*.5)
add(sub,impact(2.5,55),ta2,.6)
for i in range(3):
    t=K['a2b']+i*.28; nn=int(.16*SR); x=(sine(1318.5,nn)+sine(1976,nn)*.6)*env(nn,.002,.1)*.22; add(dry,x,t,1,(-1)**i*.5); add(dly,x,t,.5)
add(sub,impact(1.5,80),K['a2c']+.15,.5); add(sfx,click(),K['a2c']+.15,1.2)
nb_=int((K['kill']-ta2)/BEAT)
for i in range(nb_):
    t=np.ceil(ta2/BEAT)*BEAT+i*BEAT
    if t>=K['kill']-.05: break
    if i%2==0: add(drums,kick(.55),t); add(drums,kick(.35),t+.18)
    add(drums,hat(),t+.25,.4+.5*i/nb_,.3)
    if t>K['kill']-3: add(drums,hat(),t+.125,.4,-.3); add(drums,hat(),t+.375,.4,.5)
for t,m_ in ((ta2+.8,62),(ta2+2.2,61),(ta2+3.6,58),(K['kill']-1.5,57)):
    if t<K['kill']-.5: k_=keys(m_); add(dry,k_,t,.45,rs.uniform(-.4,.4)); add(wet,k_,t,.6)
add(sfx,riser(3.0,200,7000,tone=50),K['kill']-3.0,.9)
add(sfx,click(),K['kill']-.02,1.6)
add(sfx,powerdown(1.8),K['kill']+.02,.9); add(sub,impact(4.5,70),K['kill'],1.2); add(wet,impact(2,90,2.0),K['kill'],.5)
add(sfx,glitch(.5),K['kill']+.02,.8)
# ---------- B: the ping & the reveal ----------
for i in range(3):
    t=K['B']+.6+i*1.25
    if t<K['logo']-.9:
        b=bell(74,3); add(dry,b,t,.5); add(dly,b,t,.6); add(wet,b,t,.7)
for m_ in CH[0]+[62]: add(wet,pad_note(m_,K['logo']-K['B']-.5,fc=900,a=2.5,r=.5),K['B']+.4,.35)
add(sfx,riser(2.0,300,10000,tone=62),K['logo']-2.0,.8)
def hit(t,g=1.0,ch=None,bright=1.0):
    add(sub,impact(3.5,64),t,1.0*g); add(wet,impact(1.5,90,2.2*bright),t,.4*g)
    c=CH[chord_at(t)] if ch is None else ch
    for m in c:
        for o in (0,12,24):
            p=pad_note(m+o,1.2,fc=4200*bright,a=.004,r=1.6); add(dry,p,t,.3*g); add(wet,p,t,.45*g)

hit(K['logo'],1.0,[50,54,57])
for m_ in (50,54,57,62,66): add(wet,pad_note(m_+12,K['C']-K['logo']-.3,fc=2600,a=.05,r=1.5),K['logo'],.22)
for i,m_ in enumerate([74,78,81,86,81,78,74,78,81,86,90,86,81,78,81,86]):
    t=K['logo']+i*.25
    if t<K['C']-.1: p=pluck(m_,.6,4500); add(dry,p,t,.28,(-1)**i*.5); add(dly,p,t,.4)
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

# ---------- C: the feed ----------
tp=K['post']
add(sfx,whoosh(.7),K['C']-.4,.8)
groove(K['C'],tp,kick_on=True,hats=False,claps=False,arp=False,padg=.28,g=.8)
for i in range(int((tp-K['C']-.6)*8)):   # typing ticks
    if rs.rand()<.7: add(sfx,click(),K['C']+.5+i*.125,.35,rs.uniform(-.3,.3))
add(sfx,click(),tp-.02,1.6); add(sfx,whoosh(.5),tp+.05,.7)
b=bell(86,2.5); add(dry,b,tp+.1,.6); add(wet,b,tp+.1,.8); b=bell(93,2.5); add(dry,b,tp+.22,.4); add(dly,b,tp+.22,.5)
groove(tp,K['F'],hats=True,claps=True,arp=True,padg=.3); lead(tp+1.5,K['F']-1.0,.8)
for i in range(3):
    b=bell(81+i*4,1.2); add(dry,b,tp+1.0+i*.85,.35,(-1)**i*.5); add(dly,b,tp+1.0+i*.85,.3)
for i in range(8): add(drums,clap(),K['F']-1.0+i*.125,.25+.5*i/8)
add(sfx,riser(2.0,300,10000,tone=62),K['F']-2.0,.8)
# ---------- F: stop-time hits ----------
NB=len(K['beats'])
for i,t in enumerate(K['beats']):
    last=i==NB-1
    hit(t,1.0 if last else .85,bright=1.3 if last else .8); add(drums,kick(1.2),t); add(drums,clap(),t,.9)
    if not last:
        add(drums,hat(),t+.5,.6,.3); add(drums,hat(),t+1.0,.6,-.3); add(drums,kick(.7),t+1.0); add(drums,kick(.8),t+1.25)
        add(sfx,whoosh(.45),t+1.1,.6)
        nn=int(.25*SR); kk=np.arange(nn)/nn; add(sfx,lp(saw(1200*np.exp(-kk*2.2),nn),4000)*(1-kk)*.25,t+.42,.9)
tl=K['beats'][-1]
groove(tl,K['E'],padg=.35,g=1.0)
# ---------- E: private, airy ----------
add(sfx,whoosh(.8),K['E']-.4,.8); hit(K['E'],.5)
groove(K['E'],K['D']-2.0,kick_on=False,hats=False,claps=False,arp=True,bass=True,half=True,padg=.42,g=.9)
groove(K['D']-2.0,K['D'],kick_on=False,hats=True,claps=False,arp=True,bass=True,padg=.42,g=.9)
for i in range(int((K['D']-K['E'])*8)):
    if rs.rand()<.45:
        t=K['E']+i*.125; nn=int(.035*SR); x=sine(rs.choice([1568,2093,2637,3136,3951]),nn)*env(nn,.002,.02)*.07; add(dly,x,t,1,rs.uniform(-.8,.8)); add(dry,x,t,.6,rs.uniform(-.8,.8))
for i in range(16): add(drums,clap(),K['D']-2.0+i*.125,.25+.5*i/16)
add(sfx,riser(3.0,250,11000,tone=62),K['D']-3.0,.9)
# ---------- D: nobody can switch it off ----------
to=K['offTry']
hit(K['D'],.9); add(sfx,whoosh(.7),K['D']-.4,.8)
groove(K['D'],to,padg=.32); lead(K['D'],to,.85)
add(sfx,click(),to-.02,1.6); add(sfx,powerdown(.45),to+.02,.55)
nn=int(.3*SR); kk=np.arange(nn)/nn; boing=sine(300*2**(kk*1.7),nn)*env(nn,.005,.08)*.3; add(dry,boing,to+.42,1); add(dly,boing,to+.42,.5)
hit(to+.5,1.0,bright=1.4)
groove(to+1.0,K['G'],padg=.34,g=1.0); lead(to+1.0,K['G'],.95)
for i in range(6): add(drums,clap(),K['G']-.75+i*.125,.4+.1*i)
# ---------- G: full chorus, ring out ----------
hit(K['G'],1.0,bright=1.4); add(sfx,whoosh(.7),K['G']-.4,.8)
tend=K['END']-4.0
groove(K['G'],tend,padg=.36,lead=True,g=1.0); lead(K['G'],tend,1.0)
hit(tend,1.0,[50,54,57],bright=1.4)
for m_ in (38,50,57,62,66,69,74):
    p=pad_note(m_,3.2,fc=2400,a=.02,r=2.6); add(wet,p,tend,.3); add(dry,p,tend,.15)
for i,m_ in enumerate([74,78,81,86,90,93]): b=bell(m_,3); add(dry,b,tend+i*.125,.3,(-1)**i*.5); add(wet,b,tend+i*.125,.5); add(dly,b,tend+i*.125,.3)
b=bell(86,3); add(wet,b,K['g2'],.6); add(dry,b,K['g2'],.3)

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
gk(K['C'],K['F']); gk(tl,K['E']); gk(K['D'],to); gk(to+1,K['G']); gk(K['G'],tend)
e=sc_env(kts)[:,None]
music=(dry*1.7+dly*1.5+delay(dly,.375,.5,6)*1.5)*e + (reverb(wet+dry*.3+dly*.6+sfx*.35,3.0,5200)*.75)*(.5+.5*e) + sub*(.6+.4*e)*.5
music=hp(music,28)
mix=music*.9+lp(drums,150)*.6+hp(drums,150)*1.25+reverb(drums,.9,6000,seed=3)*.08+sfx*.8
mix=mix+hp(mix,4500)*.9   # air shelf
# master: gentle glue + soft clip
mix=np.tanh(mix*.8)/np.tanh(.8)*.8
fo=int(2.4*SR); mix[-fo:]*=np.linspace(1,0,fo)[:,None]**1.5
pk=np.abs(mix).max(); mix*=.89/pk
sf.write(OUT,mix,SR,subtype='PCM_24'); print('peak',pk,'rms',np.sqrt((mix**2).mean()),'dur',DUR)
