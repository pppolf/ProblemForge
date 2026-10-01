import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from './http-client.ts';
const f=JSON.parse(await readFile('.local/verify-p2-fixture.json','utf8')), c=new Client();await c.login(f.authorEmail,f.authorPassword);
const profiles=await c.call('/compile-profiles'), p=await c.call('/problems','POST',{title:`P3 双向交互验证 · ${Date.now()}`,language:'zh-CN'});
async function program(name:string,role:string,source:string,language='PYTHON3') {return c.call(`/problems/${p.id}/programs`,'POST',{name,role,source,profileId:profiles.find((p:any)=>p.language===language).id,expectedVerdicts:[role==='WRONG_SOLUTION'?'WA':role==='TIME_LIMIT_SOLUTION'?'TLE':'AC'],notes:'',enabled:true});}
const main=await program('正常交互与隐藏输入隔离','MAIN_SOLUTION',await readFile('fixtures/judge/double-interactive.py','utf8'));
const wrong=await program('答错后无限等待','WRONG_SOLUTION','import time\nn=int(input())\nprint(0,flush=True)\ntime.sleep(20)');
const noflush=await program('未 flush 的解法','TIME_LIMIT_SOLUTION',await readFile('fixtures/judge/no-flush.cpp','utf8'),'CPP17');
const interactor=await program('双倍协议 Interactor','INTERACTOR',await readFile('fixtures/judge/double-interactor.cpp','utf8'),'CPP17');
await program('合法输入','VALIDATOR',await readFile('fixtures/judge/sum-validator.cpp','utf8'),'CPP17');
await c.call(`/problems/${p.id}/tests`,'POST',{number:1,groupName:'main',isSample:false,enabled:true,notes:'',inputBase64:Buffer.from('9 13\n').toString('base64'),answerBase64:null});
let settings=await c.call(`/problems/${p.id}/judge-settings`);
settings=await c.call(`/problems/${p.id}/judge-settings`,'PUT',{expectedVersion:settings.version,settings:{...settings.settings,interactionMode:'INTERACTIVE',interaction:{verdictMode:'DIRECT',interactorTimeMs:2000,interactorMemoryMb:256,wallTimeMs:10000,idleTimeMs:800,transcriptBytes:1024}}});
const submit=()=>c.call(`/problems/${p.id}/test-runs`,'POST',{purpose:'ACCEPTANCE',requestKey:randomUUID()});
const direct=await c.waitRun((await submit()).id);assert.equal(direct.state,'SUCCEEDED',direct.log);
for(const [id,expected] of [[main.id,'AC'],[wrong.id,'WA'],[noflush.id,'TLE']]) assert.equal(direct.report.matrix.find((m:any)=>m.programId===id).verdict,expected,JSON.stringify(direct.report.matrix));
const mainRun=direct.invocations.find((i:any)=>i.programId===main.id&&i.phase==='MAIN_SOLUTION');
assert(direct.invocations.find((i:any)=>i.id===mainRun.detail.interactorInvocationId).wallTimeMs>=400,'EOF 后工具仍在执行，不能提前清理');
const transcript=await c.bytes(`/invocations/${mainRun.id}/transcript`);const lines=transcript.toString().trim().split('\n').map(l=>JSON.parse(l));
assert(lines.some(l=>l.kind==='TRUNCATED'));assert(lines.every((l,i)=>l.seq===i+1));assert(lines.filter(l=>l.base64).reduce((s,l)=>s+Buffer.from(l.base64,'base64').length,0)<=1024);
assert((await c.bytes(`/invocations/${mainRun.id}/stderr`)).toString().includes('hidden files absent'));
await new Client().call(`/invocations/${mainRun.id}/transcript`,'GET',undefined,401);
console.log('PASS real bidirectional AC, valid WA survives peer cleanup, unflushed idle TLE, isolated hidden input, bounded ordered private transcript.');
settings=await c.call(`/problems/${p.id}/judge-settings`,'PUT',{expectedVersion:settings.version,settings:{...settings.settings,interaction:{...settings.settings.interaction,idleTimeMs:10000,wallTimeMs:20000}}});
const pending=await submit();let progress:any;const deadline=Date.now()+60000;
while(Date.now()<deadline){progress=await c.call(`/test-runs/${pending.id}`);if(progress.report?.matrix?.length>=2&&progress.state==='RUNNING')break;assert(!['FAILED','CANCELED','SUCCEEDED'].includes(progress.state),progress.log);await new Promise(r=>setTimeout(r,100));}
await new Promise(r=>setTimeout(r,100));const at=Date.now();await c.call(`/test-runs/${pending.id}/cancel`,'POST');const canceled=await c.waitRun(pending.id,15000);assert.equal(canceled.state,'CANCELED');assert.equal(canceled.invocations.filter((i:any)=>i.verdict==='CANCELED').length,2);
const cancelElapsedMs=Date.now()-at;
async function disable(prog:any){const {source}=prog.currentRevision;await c.call(`/programs/${prog.id}`,'PUT',{name:prog.name,role:prog.role,profileId:prog.profileId,expectedVerdicts:prog.expectedVerdicts,notes:prog.notes,source,enabled:false,expectedVersion:prog.version});}
await disable(noflush);
// Explicit second mode: Interactor records to tout, Checker compares that output.
await c.call(`/programs/${interactor.id}`,'PUT',{name:interactor.name,role:interactor.role,profileId:interactor.profileId,expectedVerdicts:interactor.expectedVerdicts,notes:'',enabled:true,expectedVersion:interactor.version,source:interactor.currentRevision.source.replace('if (value != 2*n) quitf(_wa, "expected double, got %d", value);','')});
settings=await c.call(`/problems/${p.id}/judge-settings`,'PUT',{expectedVersion:settings.version,settings:{...settings.settings,interaction:{...settings.settings.interaction,verdictMode:'CHECKER',idleTimeMs:1000,wallTimeMs:10000}}});
const checked=await c.waitRun((await submit()).id);assert.equal(checked.state,'SUCCEEDED',checked.log);assert.equal(checked.report.matrix.find((m:any)=>m.programId===wrong.id).verdict,'WA');
await writeFile('.local/verify-p3-interaction.json',JSON.stringify({problemId:p.id,directRunId:direct.id,canceledRunId:canceled.id,checkerRunId:checked.id,transcriptBytes:transcript.length,cancelElapsedMs,checks:['bidirectional AC','valid WA and peer cleanup','idle TLE','hidden files absent','bounded ordered transcript','private transcript','cancel both','Interactor output checked','subsequent run succeeds']},null,2));
console.log('PASS cancellation persists both author Invocations; subsequent Interactor → Checker run succeeds.');process.exit(0);
