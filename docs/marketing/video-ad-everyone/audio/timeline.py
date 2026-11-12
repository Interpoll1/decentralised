import json,sys,math
lang=sys.argv[1]; d={k:v['dur'] for k,v in json.load(open(f'picks_{lang}.json')).items()}
bar=lambda t:math.ceil(t/2-1e-6)*2.0; beat=lambda t:math.ceil(t*2-1e-6)/2
C={}; V={}
V['a1']=0.9; V['a2']=V['a1']+d['a1']+.55; V['a3']=V['a2']+d['a2']+.5
C['a1']=.7; C['a2']=V['a2']-.1; C['a2b']=V['a2']+d['a2']*.36; C['a2c']=V['a2']+d['a2']*.68; C['a3']=V['a3']-.1
C['kill']=beat(V['a3']+d['a3']-.15); C['B']=C['kill']+2.0
V['b1']=C['B']+.8; C['b1']=V['b1']-.15
C['logo']=bar(V['b1']+d['b1']+.45); V['b2']=C['logo']+.35
C['C']=max(C['logo']+4.0,bar(V['b2']+d['b2']+1.0))
V['c1']=C['C']+.6; C['c1']=V['c1']-.1; C['post']=C['C']+2.5
V['c2']=max(V['c1']+d['c1']+.5,C['post']+1.3); C['c2']=V['c2']-.1
C['F']=bar(V['c2']+d['c2']+.6)
bt=[C['F']]
for i in (1,2): bt.append(beat(bt[-1]+max(1.5,d[f'f{i}']+.55)))
C['beats']=bt
for i in range(3): V[f'f{i+1}']=bt[i]+.12
C['E']=max(bar(bt[2]+d['f3']+.45),bar(bt[2]+2.0))
V['e1']=C['E']+.6; C['D']=max(bar(V['e1']+d['e1']+.6),C['E']+6.0)
V['d1']=C['D']+.6; C['offTry']=beat(V['d1']+d['d1']+.1); V['d2']=C['offTry']+.8
C['G']=max(bar(V['d2']+d['d2']+.7),bar(C['offTry']+3.0))
V['g1']=C['G']+1.3; C['g1']=V['g1']; V['g2']=V['g1']+d['g1']+.6; C['g2']=V['g2']
C['END']=bar(V['g2']+d['g2']+2.4)
C={k:(round(v,3) if not isinstance(v,list) else v) for k,v in C.items()}; C['vo']={k:round(v,3) for k,v in V.items()}
json.dump(C,open(f'../ad2/cue_{lang}.json','w'),indent=1); print(lang,json.dumps(C)[:420])
