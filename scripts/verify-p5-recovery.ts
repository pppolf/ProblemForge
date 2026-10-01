import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import { Client } from './http-client.ts';
const envPath='.local/p5-prod.env',env=parse(await readFile(envPath)),base=`http://127.0.0.1:${env.PF_HTTP_PORT}`;
assert.equal(env.COMPOSE_PROJECT_NAME,'problemforge-p5','故障演练仅操作专用 P5 实例');
const compose=['compose','--env-file',envPath,'-f','infra/compose.prod.yml'];
const docker=(args:string[])=>new Promise<void>((resolve,reject)=>{const p=spawn('docker',[...compose,...args],{stdio:'inherit',env:{...process.env,...env}});p.on('error',reject);p.on('close',code=>code?reject(new Error(`docker ${args[0]}: ${code}`)):resolve());});
const c=new Client(base,env.APP_ORIGIN),admin=new Client(base,env.APP_ORIGIN),credentials=JSON.parse(await readFile('.local/p5-deployment/author.json','utf8'));
await c.login(credentials.email,credentials.password);
if(process.argv.includes('--resume-queue')){
 const checkpoint=JSON.parse((await readFile('.local/p5-deployment/crash-checkpoint.json','utf8')).replace(/^\uFEFF/,''));
 const stopped=await c.call(`/test-runs/${checkpoint.interruptedRunId}`),retry=await c.call(`/test-runs/${checkpoint.retryRunId}`);
 assert.equal(stopped.errorCode,'WORKER_INTERRUPTED');assert.equal(retry.state,'SUCCEEDED');assert.equal(retry.retryOfId,stopped.id);
 const programs=await c.call(`/problems/${checkpoint.problemId}/programs`),main=programs.find((p:any)=>p.role==='MAIN_SOLUTION');
 let recovered:any;
 try{await docker(['stop','judge-worker']);const lost=await c.call(`/problems/${checkpoint.problemId}/test-runs`,'POST',{purpose:'COMPILE',programId:main.id,requestKey:randomUUID()});await docker(['run','--rm','-T','--no-deps','toolbox','node','--import','tsx','scripts/queue-probe.ts','remove',lost.id]);await new Promise(r=>setTimeout(r,7000));await docker(['run','--rm','-T','--no-deps','toolbox','node','--import','tsx','scripts/queue-probe.ts','exists',lost.id]);await docker(['start','judge-worker']);recovered=await c.waitRun(lost.id);assert.equal(recovered.state,'SUCCEEDED',recovered.log);}finally{await docker(['start','judge-worker']);}
 await writeFile('.local/verify-p5-recovery.json',JSON.stringify({...checkpoint,redisRecoveredRunId:recovered.id,checks:['previous actual SIGKILL and explicit retry verified again','partial evidence retained, no success after lost lease','actual Redis job deletion recovered from queued DB record']},null,2));console.log('PASS deployed crash checkpoint and Redis recovery');process.exit(0);
}
await admin.login(env.PF_ADMIN_EMAIL,env.PF_ADMIN_PASSWORD);
const health=await admin.call('/admin/operations');assert.equal(health.tasks.judge,0);assert.equal(health.status,'ok');
const p=await c.call('/problems','POST',{title:'P5 Worker 中断与 Redis 丢失演练',language:'zh-CN'});
const profiles=await c.call('/compile-profiles'),profile=profiles.find((p:any)=>p.language==='PYTHON3'&&p.enabled);
const program=(name:string,role:string,source:string,profileId=profile.id)=>c.call(`/problems/${p.id}/programs`,'POST',{name,role,source,profileId,expectedVerdicts:['AC'],enabled:true,notes:''});
const generator=await program('有界慢生成器','GENERATOR','import time\ntime.sleep(0.2)\nprint("2 3")'),reference=await program('主标程','MAIN_SOLUTION','a,b=map(int,input().split())\nprint(a+b)'),candidate=await program('正确解','CORRECT_SOLUTION','print(sum(map(int,input().split())))');
await program('整数输入校验','VALIDATOR',await readFile('fixtures/judge/sum-validator.cpp','utf8'),profiles.find((p:any)=>p.language==='CPP17'&&p.enabled).id);
await c.call(`/problems/${p.id}/stress-config`,'PUT',{expectedVersion:0,data:{generatorId:generator.id,referenceId:reference.id,candidateId:candidate.id,checkerId:null,argv:[],seed:'20261001',iterations:30,budgetMs:30000,stop:'FIRST_COUNTEREXAMPLE'}});
const run=await c.call(`/problems/${p.id}/test-runs`,'POST',{purpose:'STRESS',requestKey:randomUUID()});
let observed:any;const deadline=Date.now()+15000;
while(Date.now()<deadline){observed=await c.call(`/test-runs/${run.id}`);assert(['QUEUED','RUNNING'].includes(observed.state),observed.log);if(observed.state==='RUNNING'&&observed.invocations.some((i:any)=>i.phase==='GENERATOR'))break;await new Promise(r=>setTimeout(r,100));}
assert(observed.invocations.some((i:any)=>i.phase==='GENERATOR'),'必须先有真实执行证据');const partial=observed.invocations.map((i:any)=>i.id),killedAt=new Date();
let interrupted:any,retry:any,recovered:any;
try{
 await docker(['kill','-s','SIGKILL','judge-worker']);
 interrupted=await c.waitRun(run.id,80000);assert.equal(interrupted.state,'FAILED');assert.equal(interrupted.errorCode,'WORKER_INTERRUPTED');assert(partial.every((id:string)=>interrupted.invocations.some((i:any)=>i.id===id)));assert.equal(interrupted.accepted,false);
 assert.equal((await admin.request('/health')).status,503);console.log('PASS real SIGKILL, expired lease, retained evidence and degraded readiness');
 await docker(['start','judge-worker']);
 retry=await c.waitRun((await c.call(`/test-runs/${run.id}/retry`,'POST',{requestKey:randomUUID()})).id);assert.equal(retry.state,'SUCCEEDED',retry.log);assert.equal(retry.report.stress.outcome,'ITERATION_LIMIT');
 await writeFile('.local/p5-deployment/crash-checkpoint.json',JSON.stringify({problemId:p.id,interruptedRunId:interrupted.id,retryRunId:retry.id,partialIds:partial,killedAt,lastHeartbeatAt:interrupted.heartbeatAt,finishedAt:interrupted.finishedAt,killMethod:'SIGKILL observed in dedicated Compose recovery drill'}));
 await docker(['stop','judge-worker']);
 const lost=await c.call(`/problems/${p.id}/test-runs`,'POST',{purpose:'COMPILE',programId:reference.id,requestKey:randomUUID()});
 await docker(['run','--rm','-T','--no-deps','toolbox','node','--import','tsx','scripts/queue-probe.ts','remove',lost.id]);
 await new Promise(r=>setTimeout(r,7000));
 await docker(['run','--rm','-T','--no-deps','toolbox','node','--import','tsx','scripts/queue-probe.ts','exists',lost.id]);
 await docker(['start','judge-worker']);recovered=await c.waitRun(lost.id);assert.equal(recovered.state,'SUCCEEDED',recovered.log);
}finally{await docker(['start','judge-worker']);}
await writeFile('.local/verify-p5-recovery.json',JSON.stringify({problemId:p.id,killedAt,interruptedRunId:interrupted.id,partialInvocations:partial.length,recoveryMs:new Date(interrupted.finishedAt).getTime()-killedAt.getTime(),retryRunId:retry.id,redisRecoveredRunId:recovered.id,checks:['real worker SIGKILL during sandbox execution','partial evidence retained, no success after lost lease','readiness degraded','explicit immutable retry succeeds','actual Redis job deletion recovered from queued DB record']},null,2));
console.log('PASS deployed crash and Redis recovery');process.exit(0);
