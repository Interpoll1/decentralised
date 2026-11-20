import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, writeFile, readdir, utimes, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readBounded, saveArtifact } from './io.mjs';
import { validateConnectionConfig, createConnection } from './connect.mjs';
import { readCapture } from './mysql-source.mjs';
import { buildExport, verifyExport } from './export.mjs';
import { runPilot } from './runner.mjs';
import { syntheticInput } from './scenarios.mjs';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
async function workspace(t) {
  const path = await mkdtemp(join(tmpdir(), 'interpoll-pilot-test-'));
  t.after(() => rm(path, {recursive:true,force:true}));
  return path;
}

test('bounded file reader accepts exact bytes and rejects directories, oversized files and invalid bounds', async t => {
  const dir = await workspace(t), path = join(dir,'input.json');
  await writeFile(path, 'abc');
  assert.equal((await readBounded(path,3)).toString(), 'abc');
  await assert.rejects(readBounded(path,2), /FILE_BOUND/);
  await assert.rejects(readBounded(dir,100), /FILE_BOUND/);
  for (const limit of [0,-1,NaN,1.1,2_097_153]) await assert.rejects(readBounded(path,limit), /FILE_BOUND/);
});

test('JSON report preserves fractional timings and writes only exclusive completed artifacts', async t => {
  const root = await workspace(t), dir = join(root,'out');
  const value = {status:'NO_PATTERN',timing:{totalMs:1.25,absent:undefined}};
  const first = await saveArtifact(dir,'report',value);
  const second = await saveArtifact(dir,'report',value);
  assert.notEqual(first,second);
  assert.equal(resolve(dir),resolve(first,'..'));
  assert.deepEqual(JSON.parse(await readFile(first,'utf8')),{status:'NO_PATTERN',timing:{totalMs:1.25}});
  assert.equal((await readdir(dir)).length,2);
  for (const now of [NaN,Infinity,-1,1.1,'../../escape'])
    await assert.rejects(saveArtifact(join(root,'never-created'),'report',{}, {now}), /CLOCK/);
  await assert.rejects(readdir(join(root,'never-created')), {code:'ENOENT'});
  await assert.rejects(saveArtifact(dir,'other',{}), /ARTIFACT_KIND/);
  await assert.rejects(saveArtifact(dir,'report',{n:Infinity}), /ARTIFACT_VALUE/);
  await assert.rejects(saveArtifact(dir,'report',undefined), /ARTIFACT_VALUE/);
  await assert.rejects(saveArtifact(dir,'report',{blob:'x'.repeat(2_097_152)}), /ARTIFACT_BOUND/);
});

test('managed output refuses excess, stale, touched stale-name, unmanaged and locked evidence', async t => {
  const root = await workspace(t), now = Date.now(), dir = join(root,'cap');
  for(let i=0;i<20;i++) await saveArtifact(dir,'bundle',{n:i},{now});
  await assert.rejects(saveArtifact(dir,'bundle',{}, {now}), /RETENTION_LIMIT/);
  const report = await saveArtifact(dir,'report',{}, {now});
  await utimes(report,new Date(now-86_400_001),new Date(now-86_400_001));
  await assert.rejects(saveArtifact(dir,'report',{}, {now}), /RETENTION_EXPIRED/);

  const stale = join(root,'copied'); await mkdir(stale);
  await writeFile(join(stale,`pilot-${now-86_400_001}-${'a'.repeat(16)}.bundle.json`),'{}');
  await assert.rejects(saveArtifact(stale,'report',{}, {now}), /RETENTION_EXPIRED/);
  const unmanaged = join(root,'unmanaged'); await mkdir(unmanaged);
  await writeFile(join(unmanaged,'notes.txt'),'keep');
  await assert.rejects(saveArtifact(unmanaged,'report',{}), /OUTPUT_NOT_MANAGED/);
  assert.equal(await readFile(join(unmanaged,'notes.txt'),'utf8'),'keep');
  const locked = join(root,'locked'); await mkdir(join(locked,'.pilot-lock'),{recursive:true});
  await assert.rejects(saveArtifact(locked,'report',{}), /OUTPUT_BUSY/);
});

test('output rejects symlink/junction directory and input symlink when platform permits creation', async t => {
  const root = await workspace(t), real = join(root,'real'), alias = join(root,'alias'); await mkdir(real);
  await symlink(real,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(saveArtifact(alias,'report',{}), /OUTPUT_DIRECTORY/);
  const target = join(real,'file'); await writeFile(target,'abc');
  try { await symlink(target,join(root,'file-link'),'file'); }
  catch(error) { if(process.platform==='win32' && error.code==='EPERM') return; throw error; }
  await assert.rejects(readBounded(join(root,'file-link'),10), /FILE_BOUND/);
});

test('concurrent publishers refuse busy output without replacement or partial artifact', async t => {
  const root = await workspace(t), dir = join(root,'out');
  const results = await Promise.allSettled(Array.from({length:8},(_,i)=>saveArtifact(dir,'report',{i})));
  const passed = results.filter(x=>x.status==='fulfilled');
  assert.ok(passed.length>=1);
  for(const r of results.filter(x=>x.status==='rejected')) assert.match(r.reason.message,/OUTPUT_BUSY/);
  assert.equal((await readdir(dir)).length,passed.length);
  for(const r of passed) assert.equal(typeof JSON.parse(await readFile(r.value,'utf8')).i,'number');
});

test('connection config permits only explicit loopback or socket and rejects driver extensions before connecting', async () => {
  const config = {host:'127.0.0.1',port:3306,user:'pilot_read',password:'synthetic-only',database:'pilot_test'};
  assert.equal(validateConnectionConfig(config),config);
  validateConnectionConfig({...config,host:'::1'});
  validateConnectionConfig({socketPath:'/run/mysqld/mysqld.sock',user:config.user,password:config.password,database:config.database});
  for(const value of [null,[],{...config,host:'example.org'}, {...config,host:'localhost'}, {...config,port:0},
    {...config,multipleStatements:true},{...config,socketPath:'/tmp/mysql.sock'},{...config,database:'db;DROP'}, {...config,password:''}])
    assert.throws(()=>validateConnectionConfig(value),/DB_CONFIG|DB_LOCAL_ONLY/);
  await assert.rejects(createConnection({...config,host:'example.org'}),/DB_LOCAL_ONLY/);
});

test('SQL adapter projection composes with signed export and fresh-worker replay (injected DB double)', async () => {
  const input = syntheticInput(); const sql = [];
  const connection = {async query(options) {
    sql.push(options.sql);
    if(options.sql.includes('AS readAt')) return [[{readAt:String(input.now)}],[]];
    if(options.sql.includes('FROM engagement_actions_v1')) return [input.capture.rows,[]];
    if(options.sql.includes('FROM gun_nodes')) return [input.capture.metadata.map(r=>({...r,documentType:'OBJECT',idType:'STRING',
      communityIdType:r.communityId===null?null:'STRING',isPrivate:'false',isEncrypted:'false',deleted:null,isDeleted:null,encrypted:0})),[]];
    return [{},[]];
  }};
  const capture = await readCapture(connection,input.policy);
  assert.equal(sql.at(-1),'ROLLBACK');
  const bundle = buildExport({...input,capture});
  verifyExport(bundle,input.expectedPolicyDigest,{now:input.now});
  const report = await runPilot(bundle,input.expectedPolicyDigest,{now:input.now});
  assert.equal(report.status,'REVIEW_CANDIDATES');
  assert.equal(report.verification.status,'VERIFIED_RELATIVE_TO_SNAPSHOT');
  assert.equal(report.source.completeness,'not-established');
});

test('actual CLI scenarios persist three reports, preserve timings and disclose campaign ambiguity', async t => {
  const dir = join(await workspace(t),'reports');
  const result = await execute(process.execPath,[cli,'scenarios',dir],{timeout:60_000,maxBuffer:1_000_000});
  assert.equal(result.stderr,'');
  const lines = result.stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(lines.map(x=>[x.scenario,x.status,x.passed]),[
    ['normal','NO_PATTERN',true],['coordinated','REVIEW_CANDIDATES',true],['legitimate-campaign','REVIEW_CANDIDATES',true]]);
  const reports = await Promise.all(lines.map(x=>readFile(x.path,'utf8').then(JSON.parse)));
  for(const r of reports) {
    assert.equal(r.synthetic,true); assert.ok(r.report.timing.totalMs>0);
    assert.equal(r.report.verification.status,'VERIFIED_RELATIVE_TO_SNAPSHOT');
  }
  assert.deepEqual(reports[1].report.receipt,reports[2].report.receipt);
});

test('CLI errors suppress input details and invalid policy authority blocks export before DB/key files', async t => {
  const dir = await workspace(t), path = join(dir,'policy.json');
  await writeFile(path,JSON.stringify(syntheticInput().policy));
  await assert.rejects(execute(process.execPath,[cli,'export',path,'0'.repeat(64),'missing-db-secret','missing-key-secret',join(dir,'out')]),error=>{
    assert.equal(error.code,1); assert.match(error.stderr,/POLICY_AUTHORITY/);
    assert.doesNotMatch(error.stderr,/missing-db-secret|missing-key-secret/); return true;
  });
  const malformed = join(dir,'malformed.json'); await writeFile(malformed,'SECRET-INPUT');
  await assert.rejects(execute(process.execPath,[cli,'run',malformed,'0'.repeat(64),join(dir,'out')]),error=>{
    assert.equal(error.code,1); assert.match(error.stderr,/PILOT_FAILED/);
    assert.doesNotMatch(error.stderr,/SECRET-INPUT|SyntaxError/); return true;
  });
});
