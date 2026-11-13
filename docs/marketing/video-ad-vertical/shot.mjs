import {chromium} from 'playwright';import {serve} from './serve.mjs';import fs from 'fs';
const [v,lang,ts,port='8424']=process.argv.slice(2);
const srv=await serve(process.cwd(),+port);fs.mkdirSync('stills',{recursive:true});
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:1080,height:1920}});p.on('console',m=>console.log('PAGE',m.text()));p.on('pageerror',e=>console.log('ERR',e.message,e.stack));
await p.goto(`http://localhost:${port}/index.html?v=${v}&lang=${lang}`);await p.waitForFunction('window.ready',{timeout:60000});
for(const t of ts.split(',')){await p.evaluate(t=>window.renderFrame(t),+t);await p.screenshot({path:`stills/${v}_${lang}_${(+t).toFixed(2)}.jpg`,type:'jpeg',quality:80});}
await b.close();srv.close();
