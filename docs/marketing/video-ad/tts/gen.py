import json,sys,os,time,torch,torchaudio as ta
_ol=torch.load
torch.load=lambda *a,**k:_ol(*a,**{**k,'map_location':torch.device('cpu')})
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
lines=json.load(open('lines.json'))
takes=int(sys.argv[1]) if len(sys.argv)>1 else 2
CFG=float(os.environ.get('CFG','0.4'));EX=float(os.environ.get('EX','0.45'));S0=int(os.environ.get('S0','0'))
only=sys.argv[2].split(',') if len(sys.argv)>2 else None
m=ChatterboxMultilingualTTS.from_pretrained(device=torch.device('cpu'))
os.makedirs('out',exist_ok=True)
for lang in ['en','fr']:
  for k,t in lines[lang].items():
    if only and f'{lang}:{k}' not in only: continue
    for s in range(S0,S0+takes):
      f=f'out/{lang}_{k}_{s}.wav'
      if os.path.exists(f) and not only: continue
      torch.manual_seed(1000+s*7+sum(map(ord,k)))
      t0=time.time()
      w=m.generate(t,language_id=lang,exaggeration=EX,cfg_weight=CFG,temperature=0.7)
      ta.save(f,w,m.sr)
      print(f,round(w.shape[-1]/m.sr,2),'s gen',round(time.time()-t0,1),flush=True)
print('ALLDONE',flush=True)
