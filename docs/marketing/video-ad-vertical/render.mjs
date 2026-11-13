// node render.mjs v lang startFrame endFrame port -> frames/{v}_{lang}/%05d.jpg (1080x1920, 30 fps)
import {chromium} from 'playwright';import {serve} from './serve.mjs';import fs from 'fs';
const [v,lang,a,b,port]=process.argv.slice(2);const FPS=30;
const srv=await serve(process.cwd(),+port);const dir=`frames/${v}_${lang}`;fs.mkdirSync(dir,{recursive:true});
const br=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p=await br.newPage({viewport:{width:1080,height:1920}});p.on('pageerror',e=>{console.log('ERR',e.message);});
await p.goto(`http://localhost:${port}/index.html?v=${v}&lang=${lang}`);await p.waitForFunction('window.ready',{timeout:120000});
for(let f=+a;f<+b;f++){const out=`${dir}/${String(f).padStart(5,'0')}.jpg`;if(fs.existsSync(out))continue;
  await p.evaluate(t=>window.renderFrame(t),f/FPS);await p.screenshot({path:out+'.tmp.jpg',type:'jpeg',quality:96});fs.renameSync(out+'.tmp.jpg',out);}
await br.close();srv.close();console.log('DONE',v,lang,a,b);
