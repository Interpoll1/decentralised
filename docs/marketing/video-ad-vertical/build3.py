s=open('../ad2/main.js').read()
def cut(a,b,frm=0):
    i=s.index(a,frm); j=s.index(b,i); return s[i:j]
HDR="// ====================================================================="
core=s[:s.index(HDR+"\n// SCENE A")]
core=core.replace("const W = 1920, H = 1080;","const W = 1080, H = 1920;")
assert "W = 1080" in core
core=core.replace("float band=floor(uv.y*26.","float band=floor(uv.y*46.")
A3=cut("const A = (() => {","  // DOM — hero posts")+"  const AP = { kill: 1e9, a2: -9, B: 1e9 };\n"+cut("  return {\n    g, update(t) {","      // DOM\n      const warmOut")+"    }, AP\n  };\n})();\n"
A3=A3.replace("CUE.kill","AP.kill").replace("CUE.a2","AP.a2").replace("CUE.B","AP.B").replace("return {\n    g, update(t) {","return {\n    g, update(t) {",1)
assert "CUE." not in A3, [l for l in A3.split('\n') if 'CUE.' in l]
NETB=cut(HDR+"\n// NETWORK","CUR = 'B';")
i=s.index("const G = (() => {"); j=s.index("  const logo = el('div', 'abs center', 'Interpoll')",i)
k=s.index("      const blink",j); m=s.index("halo.material.opacity = .12 * ss(.4, 1.4, lt);",k)+len("halo.material.opacity = .12 * ss(.4, 1.4, lt);")
FROG="const FROG = (() => {"+s[i+len("const G = (() => {"):j]+"  return {\n    g, frog, halo, update(lt) {\n"+s[k:m]+"\n    }\n  };\n})();\n"
FROG=FROG.replace("diffuseColor.rgb*.42; diffuseColor.rgb*=.3;","diffuseColor.rgb*.16; diffuseColor.rgb*=.22;"); assert "*.16" in FROG
assert "CUE." not in FROG
core=core.replace("'400 200px \"Grand Hotel\"'","'400 200px \"Grand Hotel\"', '400 100px Anton'")
open('main.js','w').write(core+"\nCUR='X';\n"+A3+"\n"+NETB+"\n"+FROG+"\n"+open('scenes.js').read())
print('ok')
