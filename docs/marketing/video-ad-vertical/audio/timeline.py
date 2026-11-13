import json,sys,math
lang=sys.argv[1]; d={k:v['dur'] for k,v in json.load(open(f'picks_{lang}.json')).items()}
beat=lambda t:math.ceil(t*2-1e-6)/2
C={}; V={}
V['s1']=.25; C['ad']=round(V['s1']+d['s1']*.3,2); C['s1b']=round(V['s1']+d['s1']*.56,2)
C['kill']=beat(V['s1']+d['s1']-.1); C['B']=C['kill']+1.0; C['logo']=C['B']+.5; V['s2']=C['logo']+.1
C['C']=beat(V['s2']+d['s2']+.35); V['s3']=C['C']+.25; C['post']=C['C']+1.5
C['chips']=round(V['s3']+d['s3']*.6,2)
C['D']=beat(max(V['s3']+d['s3']+.3,C['post']+2.0)); V['s4']=C['D']+.25; C['offTry']=beat(C['D']+max(1.0,d['s4']*.55))
C['G']=beat(max(V['s4']+d['s4']+.4,C['offTry']+1.5)); V['s5']=C['G']+.7
C['END']=beat(V['s5']+d['s5']+1.5); C['vo']={k:round(v,3) for k,v in V.items()}
json.dump(C,open(f'../ad3/cue_short_{lang}.json','w'),indent=1); print(lang,json.dumps(C))
