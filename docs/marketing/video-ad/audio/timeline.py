# timeline.py lang -> ../ad/cue_{lang}.json (+ vo start times)
import json,sys,math
lang=sys.argv[1]; d={k:v['dur'] for k,v in json.load(open(f'picks_{lang}.json')).items()}
bar=lambda t:math.ceil(t/2-1e-6)*2.0; beat=lambda t:math.ceil(t*2-1e-6)/2
C={}; V={}
V['a1']=0.9; V['a2']=V['a1']+d['a1']+.5; V['a3']=V['a2']+d['a2']+.5
C['a1']=V['a1']-.1; C['a2']=V['a2']-.1; C['chipGap']=round(d['a2']/2.1,2); C['a3']=V['a3']-.1
C['kill']=beat(V['a3']+d['a3']-.2); C['B']=C['kill']+2.0
V['b1']=C['B']+.9; C['b1']=V['b1']-.15
C['logo']=bar(V['b1']+d['b1']+.5); V['b2']=C['logo']+.35
C['C']=max(C['logo']+4.0,bar(V['b2']+d['b2']+1.0))
C['vote']=C['C']+1.5; V['c1']=C['vote']+.9
C['tamper']=beat(V['c1']+d['c1']+.35); V['c2']=C['tamper']+.3
C['D']=max(bar(V['c2']+d['c2']+.5),bar(C['tamper']+3.5))
V['d1']=C['D']+.5; C['relayKill']=beat(V['d1']+d['d1']+.3); V['d2']=C['relayKill']+.35
C['E']=max(bar(V['d2']+d['d2']+.5),bar(C['relayKill']+2.5))
V['e1']=C['E']+.5; V['e2']=V['e1']+d['e1']+.5; C['e2']=V['e2']-.1
C['F']=max(bar(V['e2']+d['e2']+.35),C['E']+6.0)
bt=[C['F']]
for i in (1,2,3): bt.append(beat(bt[-1]+max(1.5,d[f'f{i}']+.55)))
C['beats']=bt
for i in range(4): V[f'f{i+1}']=bt[i]+.12
C['G']=max(bar(bt[3]+d['f4']+.45),bar(bt[3]+2.0))
V['g1']=C['G']+1.3; C['g1']=V['g1']; V['g2']=V['g1']+d['g1']+.6; C['g2']=V['g2']
C['END']=bar(V['g2']+d['g2']+2.4)
C={k:(round(v,3) if not isinstance(v,list) else v) for k,v in C.items()}; C['vo']={k:round(v,3) for k,v in V.items()}
json.dump(C,open(f'../ad/cue_{lang}.json','w'),indent=1); print(lang,json.dumps(C))
