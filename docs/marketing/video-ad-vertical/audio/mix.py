# mix.py lang -> short_final_{lang}.wav  (music + ducked VO)
import json,sys,numpy as np,soundfile as sf
from scipy import signal
lang=sys.argv[1]; C=json.load(open(f'../ad3/cue_short_{lang}.json'))
mus,SR=sf.read(f'short_music_{lang}.wav'); N=len(mus); vo=np.zeros(N)
def proc(x,sr):
    x=signal.resample_poly(x,SR,sr) if sr!=SR else x
    x=signal.sosfilt(signal.butter(2,75,'high',fs=SR,output='sos'),x)
    # presence + air
    x=x+signal.sosfilt(signal.butter(2,[2500,6000],'band',fs=SR,output='sos'),x)*.25
    # simple compressor (feed-forward, 3:1 above -20 dBFS RMS)
    win=int(.01*SR); e=np.sqrt(signal.lfilter(np.ones(win)/win,1,x**2)+1e-9); db=20*np.log10(e)
    g=np.where(db>-22,-(db+22)*(1-1/3),0); g=signal.sosfiltfilt(signal.butter(1,12,'low',fs=SR,output='sos'),g)
    x=x*10**(g/20)
    return x/ (np.sqrt((x**2).mean())+1e-9) * 0.11
for k,t in C['vo'].items():
    x,sr=sf.read(f'vo/{lang}_{k}.wav'); x=proc(x,sr); i=int(t*SR); n=min(len(x),N-i); vo[i:i+n]+=x[:n]
# short room on the voice
r=np.random.RandomState(5); n=int(.35*SR); ir=r.randn(n)*np.exp(-np.arange(n)/SR*22); ir[:int(.008*SR)]=0; ir/=np.sqrt((ir**2).sum())
vow=vo+signal.fftconvolve(vo,ir)[:N]*.06
# ducking envelope
win=int(.03*SR); e=np.sqrt(signal.lfilter(np.ones(win)/win,1,vo**2)); act=(e>.012).astype(float)
look=int(.12*SR); act=np.minimum(1,np.convolve(act,np.ones(look*2),'same'))
duck=signal.sosfiltfilt(signal.butter(1,3.5,'low',fs=SR,output='sos'),act); duck=np.clip(duck,0,1)
gain=10**(-8.5*duck/20)
mix=mus*gain[:,None]*.8+np.stack([vow,vow],1)*1.9
pk=np.abs(mix).max(); mix=np.tanh(mix/ max(pk,1e-9)*1.15)/np.tanh(1.15)*.93
sf.write(f'short_final_{lang}.wav',mix,SR,subtype='PCM_24')
db=lambda v:20*np.log10(np.sqrt((v**2).mean())+1e-9)
on=duck>.8; print(lang,'vo rms(active)',db(vow[on]*1.9),'music under vo',db((mus.mean(1)*gain*.8)[on]),'music alone',db((mus.mean(1)*.8)[~on]),'pk',pk)
