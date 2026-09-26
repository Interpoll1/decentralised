import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { demo, publicKey } from './fixtures.mjs';

const directory=resolve(process.argv[2]||'../coordination-impact-demo');
await mkdir(directory,{recursive:true});
await writeFile(join(directory,'snapshot.json'),JSON.stringify(demo(),null,2)+'\n',{flag:'wx'});
await writeFile(join(directory,'expected-observer.txt'),publicKey(9999)+'\n',{flag:'wx'});
console.log('Synthetic example written. Observer pin is fixture policy, not a production trust root.');
