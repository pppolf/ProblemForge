import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '@problemforge/database';
import { config, sha256, token } from '@problemforge/domain';
import { capacityStatus, storageMetrics } from '../apps/api/src/storage-metrics.ts';
import { inspectStorage, collectReferences } from './storage-inspection.ts';
import { backupFiles, encryptBackup, decryptBackup, retentionPreview } from './backup-crypto.mjs';
if(!process.argv.includes('--isolated')) {
  const refs=new Map<string,Set<string>>();collectReferences({key:'imports/package',report:{manifest:{blob:{key:'blobs/archive-member'},known:{key:'imports/known'}}}},new Set(['imports/known']),refs,'ExportArtifact');assert(refs.has('imports/package'));assert(refs.has('imports/known'));assert(!refs.has('blobs/archive-member'));
  if(process.argv.includes('--references-only')){console.log('PASS archive-member namespace distinct from stored objects; known references retained');process.exit(0);}
  const url=new URL(process.env.DATABASE_URL!),database=`problemforge_p71_verify_${randomUUID().replaceAll('-','').slice(0,12)}`,storage=resolve('.local/p71-verify',database,'storage');await mkdir(storage,{recursive:true});
  await db.$executeRawUnsafe(`CREATE DATABASE "${database}"`);await db.$disconnect();url.pathname='/'+database;
  for(const args of [['scripts/database.ts','migrate'],[fileURLToPath(import.meta.url),'--isolated']]) {const r=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',...args],{env:{...process.env,DATABASE_URL:url.toString(),STORAGE_ROOT:storage,STORAGE_QUOTA_BYTES:'10000',STORAGE_WARNING_PERCENT:'1'},stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}process.exit(0);
}
assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/problemforge_p71_verify_[a-f0-9]{12}$/);
const dir=resolve(config.storageRoot,'..','crypto');await mkdir(dir);const plain=join(dir,'plain'),encrypted=join(dir,'encrypted');await mkdir(plain);await mkdir(encrypted);
const key=randomBytes(32);for(const name of backupFiles)await writeFile(join(plain,name),randomBytes(8192));
await encryptBackup(plain,encrypted,key,'backup-verification');const decoded=join(dir,'decoded');await mkdir(decoded);await decryptBackup(encrypted,decoded,key);
for(const name of backupFiles)assert.deepEqual(await readFile(join(decoded,name)),await readFile(join(plain,name)));
const wrong=join(dir,'wrong');await mkdir(wrong);await assert.rejects(()=>decryptBackup(encrypted,wrong,randomBytes(32)),/密钥不匹配/);
const badFile=join(encrypted,'database.dump.enc'),ciphertext=await readFile(badFile);ciphertext[64]^=1;await writeFile(badFile,ciphertext);const damaged=join(dir,'damaged');await mkdir(damaged);await assert.rejects(()=>decryptBackup(encrypted,damaged,key),/认证失败/);
const keep=retentionPreview([{directory:'old',createdAt:'2020-01-01T00:00:00Z'},{directory:'new',createdAt:'2021-01-01T00:00:00Z'}],{keepLatest:1,maxAgeDays:30},new Date('2026-10-01'));assert.equal(keep.find((r:any)=>r.directory==='new').decision,'keep');assert.equal(keep.find((r:any)=>r.directory==='old').decision,'review');
assert.equal(capacityStatus(800,1000,80).status,'warning');assert.equal(capacityStatus(1000,1000,80).status,'full');assert.equal(capacityStatus(799,1000,80).status,'ok');
const old=new Date('2020-01-01');
async function object(name:string,{ready=true,missing=false,corrupt=false,recent=false}={}) {const key='verification/'+name,bytes=Buffer.alloc(100,name.charCodeAt(0));await db.storedObject.create({data:{key,hash:sha256(bytes),bytes:bytes.length,ready,createdAt:recent?new Date():old}});if(!missing){await mkdir(join(config.storageRoot,'verification'),{recursive:true});await writeFile(join(config.storageRoot,key),corrupt?Buffer.from('corrupt'):bytes);}return key;}
const frozen=await object('frozen'),history=await object('history'),published=await object('published'),cache=await object('cache'),orphan=await object('orphan'),pending=await object('pending',{ready:false,missing:true}),recent=await object('recent',{recent:true}),missing=await object('missing',{missing:true}),corrupt=await object('corrupt',{corrupt:true});
const user=await db.user.create({data:{email:'maintenance@verify.invalid',name:'Maintenance',passwordHash:'unused-fixture',role:'ADMIN'}}),problem=await db.problem.create({data:{title:'P7 offline fixture'}});
await db.problemRevision.create({data:{problemId:problem.id,number:1,label:'frozen',state:'FROZEN',manifest:{nested:{blob:{key:frozen}}},hash:'fixture',reviewHash:'fixture',createdById:user.id}});
await db.testRun.create({data:{problemId:problem.id,requestedById:user.id,requestKey:randomUUID(),purpose:'ACCEPTANCE',state:'SUCCEEDED',input:{old:{key:history}},inputHash:'fixture',dependencyHash:'fixture',report:{references:[{key:missing},{key:'verification/missing-registration'}]}}});
const exported=await db.exportArtifact.create({data:{problemId:problem.id,requestedById:user.id,revisionId:'fixture',purpose:'FULL',format:'NATIVE',key:published,hash:'fixture',bytes:100,report:[]}});
await db.release.create({data:{problemId:problem.id,purpose:'FULL',exportId:exported.id,token:token(),revokedAt:new Date()}});
await db.compileCache.create({data:{id:'fixture',problemId:problem.id,sourceRunId:'fixture',key:cache,hash:'fixture',bytes:100}});
const report=await inspectStorage();assert.deepEqual(report.cleanupPreview.candidates.map(c=>c.key),[orphan]);assert.equal(report.cleanupPreview.canDelete,false);
for(const key of [frozen,history,published,cache,missing])assert(report.retained.some(r=>r.key===key),key);
assert(report.pending.some(p=>p.key===pending));assert(report.issues.some(r=>r.key===corrupt&&r.kind==='HASH_OR_SIZE_MISMATCH'));assert(report.issues.some(r=>r.key===missing&&r.kind==='READY_FILE_MISSING'));assert(report.issues.some(r=>r.key==='verification/missing-registration'&&r.kind==='REFERENCE_NOT_REGISTERED'));assert(!report.cleanupPreview.candidates.some(r=>r.key===recent));
const metrics=await storageMetrics();assert.equal(metrics.status,'warning');assert.equal(metrics.pendingBytes,100);assert.equal(metrics.cache.bytes,100);assert(metrics.growth.length);
const {createApp}=await import('../apps/api/src/app.ts');const app=await createApp(false),raw=token();await db.session.create({data:{id:sha256(raw),userId:user.id,csrfToken:token(),expiresAt:new Date(Date.now()+3600000)}});
try {assert.equal((await app.inject({url:'/api/admin/operations'})).statusCode,401);const response=await app.inject({url:'/api/admin/operations',headers:{cookie:'pf_session='+raw}});assert.equal(response.statusCode,200);assert.equal(response.json().storage.status,'warning');assert.equal(response.json().storage.warningPercent,1);}finally{await app.close();}
assert.equal(await db.storedObject.count(),9);assert.equal((await readFile(join(config.storageRoot,orphan))).length,100);assert.equal(await db.build.count(),0);assert.equal(await db.testRun.count({where:{state:{in:['QUEUED','RUNNING']}}}),0);
await writeFile('.local/verify-p7-maintenance.json',JSON.stringify({database:new URL(process.env.DATABASE_URL!).pathname,storageRoot:config.storageRoot,checkedAt:new Date().toISOString(),checks:['AES-256-GCM exact roundtrip, wrong key and corrupted ciphertext rejected','retention keeps latest even when old; preview only','offline scan retains frozen revision, historical task, revoked export and cache references','missing/corrupt/unregistered references reported; pending/recent entries not candidates','only intact aged unreferenced fixture proposed; no deletion or execution','capacity threshold, pending/cache/growth metrics and authenticated admin API verified'],report,metrics},null,2));
await db.$disconnect();console.log('PASS encrypted backup, conservative storage inspection, retention and capacity metrics');process.exit(0);
