# pick.py: transcribe all takes, score vs script, trim, choose best take per line -> picks_{lang}.json + vo/{lang}_{k}.wav
import sys,glob,json,re,difflib,unicodedata,os
import numpy as np, soundfile as sf
from faster_whisper import WhisperModel
TTS=sys.argv[1]; L=json.load(open(f'{TTS}/lines.json'))
MODELS={'en':'small','fr':'medium'}; _m={}
def model(l):
    if l not in _m: _m[l]=WhisperModel(MODELS[l],device='cpu',compute_type='int8',cpu_threads=4)
    return _m[l]
def norm(s):
    s=unicodedata.normalize('NFKD',s.lower()); s=''.join(c for c in s if not unicodedata.combining(c))
    s=s.replace('interpoll','interpol').replace('.social',' social').replace(' dot ',' ').replace(' point ',' ').replace("there's",'there is').replace("it's",'it is')
    return re.sub(r'[^a-z0-9 ]+',' ',s).split()
TARGET={'en':2.75,'fr':3.0}
os.makedirs('vo',exist_ok=True); cache=json.load(open('qa_cache.json')) if os.path.exists('qa_cache.json') else {}
for lang in ['en','fr']:
    picks={}
    for k,text in L[lang].items():
        exp=norm(text); cands=[]
        for f in sorted(glob.glob(f'{TTS}/out/{lang}_{k}_*.wav')):
            if f not in cache:
                segs,_=model(lang).transcribe(f,language=lang,word_timestamps=True,condition_on_previous_text=False)
                cache[f]=[(w.word,w.start,w.end) for s in segs for w in s.words]; json.dump(cache,open('qa_cache.json','w'))
            ws=cache[f]; got=[]; ends=[]
            for w,a,b in ws:
                for t in norm(w): got.append(t); ends.append(b)
            x,sr=sf.read(f); dur=len(x)/sr
            # best prefix of got matching exp
            best=(0,len(got))
            for n in range(1,len(got)+1):
                r=difflib.SequenceMatcher(None,exp,got[:n]).ratio()
                if r>best[0]+1e-9: best=(r,n)
            r,n=best; cut=min(dur,ends[n-1]+(.3 if n==len(got) else .1))
            # energy-based trim
            e=np.abs(x); win=int(.02*sr); env=np.convolve(e,np.ones(win)/win,'same'); th=env.max()*.035
            idx=np.where(env[:int(cut*sr)]>th)[0]
            a,b=(idx[0]/sr,idx[-1]/sr) if len(idx) else (0,cut)
            a=max(0,a-.03); b=min(cut,b+.12); sp=b-a; rate=len(exp)/max(sp,.1)
            cands.append(dict(f=f,sim=r,a=a,b=b,sp=sp,rate=rate,extra=len(got)-n,txt=' '.join(got)))
        if not cands: print('MISSING',lang,k); continue
        mx=max(c['sim'] for c in cands); ok=[c for c in cands if c['sim']>=max(.9,mx-.03)] or sorted(cands,key=lambda c:-c['sim'])[:1]
        # short lines: rate is noisy; prefer no-extra, then closest to target rate
        clean=[c for c in ok if c['extra']==0] or ok; med=float(np.median([c['sp'] for c in clean]))
        ch=min(clean,key=lambda c:(abs(c['sp']-med),-c['sp']))
        OV={'en:f3':'_3.wav'}
        if f'{lang}:{k}' in OV: ch=[c for c in cands if c['f'].endswith(OV[f'{lang}:{k}'])][0]
        x,sr=sf.read(ch['f']); y=x[int(ch['a']*sr):int(ch['b']*sr)].copy()
        fi=int(.01*sr); fo=int(.06*sr); y[:fi]*=np.linspace(0,1,fi); y[-fo:]*=np.linspace(1,0,fo)
        sf.write(f'vo/{lang}_{k}.wav',y,sr); picks[k]=dict(take=os.path.basename(ch['f']),dur=round(len(y)/sr,3),sim=round(ch['sim'],3),rate=round(ch['rate'],2))
        print(lang,k,picks[k], '| all:',[(os.path.basename(c['f'])[-5],round(c['sim'],2),round(c['sp'],2),c['extra']) for c in cands],flush=True)
        if ch['sim']<.93: print('   !! LOW:',ch['txt'])
    json.dump(picks,open(f'picks_{lang}.json','w'),indent=1)
