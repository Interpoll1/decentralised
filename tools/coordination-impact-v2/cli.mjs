import { open, writeFile } from 'node:fs/promises';
import { ImpactWorkerV2 } from './host.mjs';
import { parseExecutionArgs } from './options.mjs';

// File-only interface; observer pin comes from caller policy, never the input.
try {
  const { args, deadlineMs } = parseExecutionArgs(process.argv.slice(2));
  const [command,path,observer,receiptPath] = args;
  if(!['analyze','verify'].includes(command) || !path || !observer || args.length>4 || (command==='verify' && !receiptPath))
    throw new Error('Usage: node tools/coordination-impact-v2/cli.mjs analyze SNAPSHOT EXPECTED_OBSERVER [OUTPUT] | verify SNAPSHOT EXPECTED_OBSERVER RECEIPT [--deadline-ms 10000]');
  async function boundedRead(p) {
    const file=await open(p,'r');
    try {
      const bytes=Buffer.alloc(1_048_577);let length=0;
      while(length<bytes.length) {
        const {bytesRead}=await file.read(bytes,length,bytes.length-length,null);
        if(!bytesRead) break;length+=bytesRead;
      }
      if(length>1_048_576) throw new Error('File exceeds 1 MiB');
      return bytes.subarray(0,length);
    } finally {await file.close();}
  }
  const response=await new ImpactWorkerV2().run(await boundedRead(path),observer,
    {deadlineMs,...(command==='verify'?{receipt:await boundedRead(receiptPath)}:{})});
  if(command==='analyze' && receiptPath && response.result.receipt)
    await writeFile(receiptPath,JSON.stringify(response.result.receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(response,null,2));
  if(['CANNOT_ESTABLISH','RECEIPT_MISMATCH'].includes(response.result.status)) process.exitCode=1;
} catch(e) {console.error(e.message);process.exitCode=1;}
