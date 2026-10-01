import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { db } from '@problemforge/database';
import { config, texQueue, judgeQueue, claimTask, renewLease, ManagedStorage, HttpError } from '@problemforge/domain';
import { Client } from './http-client.ts';
const c=new Client(),admin=new Client(),f=JSON.parse(await readFile('.local/verify-p2-fixture.json','utf8'));
await c.login(f.authorEmail,f.authorPassword);await admin.bootstrap();await c.call('/admin/operations','GET',undefined,403);assert.equal((await admin.call('/admin/operations')).status,'ok');
const proof=JSON.parse(await readFile('.local/verify-p4-collaboration.json','utf8'));
const source=proof.problemId,copy=await c.call(`/problems/${source}/copy`,'POST',{title:'P5 运行保障验收'}),p=await c.call(`/problems/${copy.id}`),doc=p.documents.find((d:any)=>d.kind==='STATEMENT'&&d.enabled&&d.templateVersionId);
assert(doc);const key=randomUUID();const [a,b]=await Promise.all([c.call('/builds','POST',{documentId:doc.id,requestKey:key}),c.call('/builds','POST',{documentId:doc.id,requestKey:key})]);assert.equal(a.id,b.id);
async function built(id:string){for(let i=0;i<180;i++){const b=await c.call(`/builds/${id}`);if(!['QUEUED','RUNNING'].includes(b.state))return b;await new Promise(r=>setTimeout(r,500));}throw new Error('build timeout');}
const first=await built(a.id);assert.equal(first.state,'SUCCEEDED',first.log);
const cache=await built((await c.call('/builds','POST',{documentId:doc.id,requestKey:randomUUID()})).id);assert.equal(cache.state,'SUCCEEDED',cache.log);assert.equal(cache.cacheSourceId,first.id);assert.deepEqual(await c.bytes(`/artifacts/${cache.artifacts[0].id}/pdf`),await c.bytes(`/artifacts/${first.artifacts[0].id}/pdf`));
const programs=await c.call(`/problems/${copy.id}/programs`),program=programs.find((p:any)=>p.role==='MAIN_SOLUTION');
const compile=async()=>c.waitRun((await c.call(`/problems/${copy.id}/test-runs`,'POST',{purpose:'COMPILE',programId:program.id,requestKey:randomUUID()})).id);
const j1=await compile(),j2=await compile();assert.equal(j1.state,'SUCCEEDED',j1.log);assert.equal(j2.state,'SUCCEEDED',j2.log);assert(j2.invocations.some((i:any)=>i.status==='Cached'));assert(!j1.invocations.some((i:any)=>i.status==='Cached'));
const input={...program.currentRevision.configuration,profileId:program.profileId,source:program.currentRevision.source+`\n${program.profile.language==='PYTHON3'?'#':'//'} P5 cache dependency change\n`,expectedVersion:program.version};delete input.expectedScore;if(program.expectedScore)input.expectedScore=program.expectedScore;
await c.call(`/programs/${program.id}`,'PUT',input);const changed=await compile();assert.equal(changed.state,'SUCCEEDED',changed.log);assert(!changed.invocations.some((i:any)=>i.status==='Cached'));
const cppProfile=(await c.call('/compile-profiles')).find((p:any)=>p.enabled&&p.language==='CPP17');
const cpp=await c.call(`/problems/${copy.id}/programs`,'POST',{name:'C++ 缓存执行验证',role:'CORRECT_SOLUTION',profileId:cppProfile.id,source:'#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}\n',expectedVerdicts:['AC'],enabled:true,notes:''});
const acceptance=async()=>c.waitRun((await c.call(`/problems/${copy.id}/test-runs`,'POST',{purpose:'ACCEPTANCE',requestKey:randomUUID()})).id);
const ac1=await acceptance(),ac2=await acceptance();assert.equal(ac1.accepted,true,ac1.log);assert.equal(ac2.accepted,true,ac2.log);assert(ac2.invocations.some((i:any)=>i.programId===cpp.id&&i.phase==='COMPILE'&&i.status==='Cached'));assert(ac2.report.matrix.filter((i:any)=>i.programId===cpp.id).every((i:any)=>i.verdict==='AC'));
// SSE reads persistent state and rechecks membership while the stream remains open.
const password=`P5-${randomUUID()}-Aa1`,viewer=await admin.call('/admin/users','POST',{email:`p5-${randomUUID()}@example.test`,name:'P5 查看者',password,role:'USER'}),v=new Client();await v.login(viewer.email,password);
await c.call(`/problems/${copy.id}/members`,'PUT',{targetType:'USER',targetId:viewer.id,role:'VIEWER',languages:[]});
const response=await v.request(`/events?problemId=${copy.id}`);assert.equal(response.status,200);const reader=response.body!.getReader(),decoder=new TextDecoder();let events='';
async function event(name:string){const timeout=AbortSignal.timeout(12000);while(!events.includes(`event: ${name}`)){const chunk=await Promise.race([reader.read(),new Promise<never>((_,reject)=>timeout.addEventListener('abort',()=>reject(new Error('SSE timeout')),{once:true}))]);if(chunk.done)break;events+=decoder.decode(chunk.value);}assert(events.includes(`event: ${name}`));}
await event('tasks');await v.bytes(`/artifacts/${cache.artifacts[0].id}/pdf`);await c.call(`/problems/${copy.id}/members`,'DELETE',{targetType:'USER',targetId:viewer.id});await event('access-revoked');await reader.cancel();await v.bytes(`/artifacts/${cache.artifacts[0].id}/pdf`,404);
const tq=texQueue(),jq=judgeQueue();tq.on('error',()=>{});jq.on('error',()=>{});
assert.equal(await db.build.count({where:{state:{in:['QUEUED','RUNNING']}}}),0,'配额验证前不打断现有任务');await tq.pause();
try{
 const responses=await Promise.all(Array.from({length:config.buildQuota+1},()=>c.request('/builds','POST',{documentId:doc.id,requestKey:randomUUID()})));assert.equal(responses.filter(r=>r.status===429).length,1);const created=await Promise.all(responses.filter(r=>r.ok).map(r=>r.json()));for(const row of created)await c.call(`/builds/${row.id}/cancel`,'POST');assert.equal(await db.build.count({where:{state:'QUEUED',requestedById:first.requestedById}}),0);
}finally{await tq.resume();}
// Simulate Redis losing an already-enqueued record; it must be recovered from DB.
const old=await db.testRun.findUniqueOrThrow({where:{id:changed.id}});
const lost=await db.testRun.create({data:{problemId:copy.id,requestedById:old.requestedById,purpose:'COMPILE',requestKey:randomUUID(),input:old.input!,inputHash:old.inputHash,dependencyHash:old.dependencyHash,queuedAt:new Date()}});
assert.equal(await jq.getJob(lost.id),undefined);const recovered=await c.waitRun(lost.id);assert.equal(recovered.state,'SUCCEEDED',recovered.log);
// Fault-injected old lease: duplicate claim and late commit/heartbeat are fenced.
const interrupted=await db.testRun.create({data:{problemId:copy.id,requestedById:old.requestedById,purpose:'COMPILE',requestKey:randomUUID(),input:old.input!,inputHash:old.inputHash,dependencyHash:old.dependencyHash,state:'RUNNING',leaseToken:'expired-proof',heartbeatAt:new Date(Date.now()-config.leaseMs-10000),startedAt:new Date(Date.now()-config.leaseMs-10000)}});
assert.equal(await claimTask('judge',interrupted.id),null);const stopped=await c.waitRun(interrupted.id);assert.equal(stopped.errorCode,'WORKER_INTERRUPTED');assert.equal(await renewLease('judge',interrupted.id,'expired-proof'),false);assert.equal((await db.testRun.updateMany({where:{id:interrupted.id,state:'RUNNING',leaseToken:'expired-proof'},data:{state:'SUCCEEDED'}})).count,0);
const [retry1,retry2]=await Promise.all([c.call(`/test-runs/${interrupted.id}/retry`,'POST',{requestKey:randomUUID()}),c.call(`/test-runs/${interrupted.id}/retry`,'POST',{requestKey:randomUUID()})]);assert.equal(retry1.id,retry2.id);assert.equal((await c.waitRun(retry1.id)).state,'SUCCEEDED');
// Cancellation arriving between a monitor read and heartbeat is not lost ownership.
const cancelLease=randomUUID(),cancelRace=await db.testRun.create({data:{problemId:copy.id,requestedById:old.requestedById,purpose:'COMPILE',requestKey:randomUUID(),input:old.input!,inputHash:old.inputHash,dependencyHash:old.dependencyHash,state:'RUNNING',leaseToken:cancelLease,heartbeatAt:new Date(),startedAt:new Date(),stage:'取消/续租时序注入，没有执行作者程序'}});
try{await db.testRun.update({where:{id:cancelRace.id},data:{cancelRequested:true}});assert.equal(await renewLease('judge',cancelRace.id,cancelLease),true);assert.equal(await renewLease('judge',cancelRace.id,randomUUID()),false);}finally{await db.testRun.updateMany({where:{id:cancelRace.id,state:'RUNNING',leaseToken:cancelLease},data:{state:'CANCELED',leaseToken:null,finishedAt:new Date()}});}
const invalid=await db.testRun.create({data:{problemId:copy.id,requestedById:old.requestedById,purpose:'COMPILE',requestKey:randomUUID(),input:old.input!,inputHash:'0'.repeat(64),dependencyHash:old.dependencyHash,state:'FAILED',errorCode:'FAULT_INJECTION',finishedAt:new Date()}});let last:any=invalid;
for(let i=1;i<config.maxAttempts;i++){last=await c.waitRun((await c.call(`/test-runs/${last.id}/retry`,'POST',{requestKey:randomUUID()})).id);assert.equal(last.state,'FAILED');}await c.call(`/test-runs/${last.id}/retry`,'POST',{requestKey:randomUUID()},409);
// Concurrent storage reservations serialize across independent adapters.
const used=Number((await db.storedObject.aggregate({_sum:{bytes:true}}))._sum.bytes??0n),originalQuota=config.storageQuotaBytes;config.storageQuotaBytes=used+5;
try{const storage=new ManagedStorage(config.storageRoot),results=await Promise.allSettled([storage.put(`quota-proof/${randomUUID()}`,Buffer.alloc(3)),storage.put(`quota-proof/${randomUUID()}`,Buffer.alloc(3))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const denied=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert(denied.reason instanceof HttpError&&denied.reason.code==='STORAGE_QUOTA');}finally{config.storageQuotaBytes=originalQuota;}
const audits=await admin.call('/admin/audit?action=TASK_LEASE_EXPIRED');assert(audits.rows.some((r:any)=>r.resourceId===interrupted.id));
await writeFile('.local/verify-p5-runtime.json',JSON.stringify({problemId:copy.id,buildId:first.id,cachedBuildId:cache.id,compileRunId:j1.id,cachedCompileRunId:j2.id,changedCompileRunId:changed.id,recoveredRunId:recovered.id,interruptedRunId:interrupted.id,retryRunId:retry1.id,checks:['parallel build idempotency','real PDF then same-object authorized PDF cache','real Linux compile cache and source invalidation','SSE update and live permission revocation','atomic concurrent task/storage quotas','queuedAt non-null missing Redis job recovery','expired DB lease and stale owner fenced','idempotent retry and finite retry chain','administrator-only health/audit and persisted recovery audit']},null,2));
await tq.close();await jq.close();await db.$disconnect();console.log('PASS P5 runtime, caches, quotas, SSE and recovery');process.exit(0);
