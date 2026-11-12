// node render.mjs lang startFrame endFrame port  -> frames/{lang}/%05d.jpg  (30 fps)
import {chromium} from 'playwright';import {serve} from './serve.mjs';import fs from 'fs';
const [lang,a,b,port]=process.argv.slice(2);const FPS=30;
const srv=await serve(process.cwd(),+port);const dir=`frames/${lang}`;fs.mkdirSync(dir,{recursive:true});
const b_=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p=await b_.newPage({viewport:{width:1920,height:1080}});p.on('pageerror',e=>{console.log('ERR',e.message);});
await p.goto(`http://localhost:${port}/index.html?lang=${lang}`);await p.waitForFunction('window.ready',{timeout:120000});
const t0=Date.now();
for(let f=+a;f<+b;f++){const out=`${dir}/${String(f).padStart(5,'0')}.jpg`;if(fs.existsSync(out))continue;
  await p.evaluate(t=>window.renderFrame(t),f/FPS);await p.screenshot({path:out+'.tmp.jpg',type:'jpeg',quality:96});fs.renameSync(out+'.tmp.jpg',out);
  if((f-a)%100===0)console.log(lang,f,((Date.now()-t0)/1000).toFixed(0)+'s');}
await b_.close();srv.close();console.log('DONE',lang,a,b);
