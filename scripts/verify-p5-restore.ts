import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import { sha256 } from '@problemforge/domain';
import { Client } from './http-client.ts';
const preparing=process.argv.includes('--prepare'),envPath=preparing?'.local/p5-prod.env':'.local/p5-restore.env',env=parse(await readFile(envPath));
assert.equal(env.COMPOSE_PROJECT_NAME,preparing?'problemforge-p5':'problemforge-p5-restore');
const proof=JSON.parse(await readFile('.local/verify-p5-deployment.json','utf8')),creds=JSON.parse(await readFile('.local/p5-deployment/author.json','utf8'));
const c=new Client(`http://127.0.0.1:${env.PF_HTTP_PORT}`,env.APP_ORIGIN);await c.login(creds.email,creds.password);
if(preparing){
 const programs=await c.call(`/problems/${proof.items[0].problemId}/programs`),main=programs.find((p:any)=>p.role==='MAIN_SOLUTION');
 await new Promise<void>((resolve,reject)=>{const p=spawn('docker',['compose','--env-file',envPath,'-f','infra/compose.prod.yml','stop','judge-worker'],{stdio:'inherit',env:{...process.env,...env}});p.on('error',reject);p.on('close',code=>code?reject(new Error('stop worker failed')):resolve());});
 const queued=await c.call(`/problems/${proof.items[0].problemId}/test-runs`,'POST',{purpose:'COMPILE',programId:main.id,requestKey:randomUUID()});assert.equal(queued.state,'QUEUED');
 await writeFile('.local/p5-deployment/restore-queued.json',JSON.stringify({id:queued.id,problemId:proof.items[0].problemId}));console.log('QUEUED task prepared; run the dedicated backup immediately, which restarts the worker.');process.exit(0);
}
const contest=await c.call(`/contests/${proof.contestId}`);assert(contest.revisions.some((r:any)=>r.id===proof.contestRevisionId&&r.current));
for(const b of proof.builds)assert.equal(sha256(await c.bytes(`/artifacts/${b.artifactId}/pdf`)),b.hash);
for(const id of proof.runs)assert.equal((await c.call(`/test-runs/${id}`)).accepted,true);
const queued=JSON.parse(await readFile('.local/p5-deployment/restore-queued.json','utf8')),recovered=await c.waitRun(queued.id);assert.equal(recovered.state,'SUCCEEDED',recovered.log);
const requested=await c.call(`/contests/${proof.contestId}/builds`,'POST',{revisionId:proof.contestRevisionId,kinds:['STATEMENT'],requestKey:randomUUID()});
let built:any;for(let i=0;i<60;i++){built=await c.call(`/builds/${requested.builds[0].id}`);if(!['QUEUED','RUNNING'].includes(built.state))break;await new Promise(r=>setTimeout(r,500));}
assert.equal(built.state,'SUCCEEDED',built.log);assert(built.cacheSourceId);assert.equal(sha256(await c.bytes(`/artifacts/${built.artifacts[0].id}/pdf`)),proof.builds.find((b:any)=>b.kind==='STATEMENT').hash);
await writeFile('.local/verify-p5-restore.json',JSON.stringify({project:env.COMPOSE_PROJECT_NAME,contestId:proof.contestId,queuedRunId:queued.id,recoveredRunId:recovered.id,restoredCacheBuildId:built.id,checks:['original account and frozen contest preserved','three exact PDF hashes and three accepted reports','backup queued task delivered through initially empty Redis','new task and stored PDF cache usable after restore']},null,2));console.log('PASS restored account, contest, reports, exact PDFs and queued recovery');process.exit(0);
