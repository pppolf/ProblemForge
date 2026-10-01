import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
import { sha256 } from '@problemforge/domain';
import { Client } from './http-client.ts';
const args=process.argv.slice(2),option=(n:string)=>args[args.indexOf('--'+n)+1];
const envPath=option('env');assert(envPath&&envPath.startsWith('.local/'));
const env=parse(await readFile(envPath));assert.match(env.COMPOSE_PROJECT_NAME!,/^problemforge-p7[a-z0-9-]*$/);
const label=option('label');assert.match(label??'',/^[a-z0-9-]+$/);
const proof=JSON.parse(await readFile('.local/verify-p5-deployment.json','utf8'));
const creds=JSON.parse(await readFile('.local/p5-deployment/author.json','utf8'));
const c=new Client(`http://127.0.0.1:${env.PF_HTTP_PORT}`,env.APP_ORIGIN);await c.login(creds.email,creds.password);
const contest=await c.call(`/contests/${proof.contestId}`);assert(contest.revisions.some((r:any)=>r.id===proof.contestRevisionId&&r.current));
for(const b of proof.builds)assert.equal(sha256(await c.bytes(`/artifacts/${b.artifactId}/pdf`)),b.hash);
for(const id of proof.runs)assert.equal((await c.call(`/test-runs/${id}`)).accepted,true);
const adminEnv=parse(await readFile('.local/p5-prod.env'));
const admin=new Client(`http://127.0.0.1:${env.PF_HTTP_PORT}`,env.APP_ORIGIN);await admin.login(adminEnv.PF_ADMIN_EMAIL!,adminEnv.PF_ADMIN_PASSWORD!);
const operations=await admin.call('/admin/operations');assert.equal(operations.status,'ok');
const checks=['frozen contest and three accepted reports preserved','three PDF hashes unchanged','all dependencies healthy'];
if(!args.includes('--p5')){
  const sessions=await c.call('/auth/sessions');assert(sessions.some((s:any)=>s.current));
  const users=await admin.call('/admin/users');assert(users.every((u:any)=>Number.isInteger(u.version)&&typeof u.passwordResetRequired==='boolean'&&!('passwordHash' in u)));
  const history=await c.call(`/builds/page?contestId=${proof.contestId}&limit=2`);assert.equal(history.rows.length,2);assert(history.nextCursor);
  const second=await c.call(`/builds/page?contestId=${proof.contestId}&limit=2&cursor=${encodeURIComponent(history.nextCursor)}`);assert(second.rows.every((r:any)=>!history.rows.some((p:any)=>p.id===r.id)));
  await c.call('/test-runs/page?limit=2');await c.call('/problems/page?limit=2');
  checks.push('P6 account/session fields and paged history APIs usable');
  if(!args.includes('--baseline')){
    const release=JSON.parse(await readFile(option('release'),'utf8'));
    assert.equal(operations.version.gitCommit,release.gitCommit);assert.equal(operations.version.buildId,release.buildId);assert.equal(operations.version.migrationsMatch,true);assert.equal(operations.version.migrations.length,10);
    const id=spawnSync('docker',['inspect',`${env.COMPOSE_PROJECT_NAME}-api-1`,'--format','{{.Image}}'],{encoding:'utf8'});assert.equal(id.status,0);assert.equal(id.stdout.trim(),release.imageId);
    const script="const fs=require('fs'),m=JSON.parse(fs.readFileSync('apps/web/dist/.vite/manifest.json')),e=Object.keys(m).find(k=>m[k].isEntry),seen=new Set();function add(k){if(seen.has(k))return;seen.add(k);for(const x of m[k].imports||[])add(x)}add(e);const files=[...seen].map(k=>m[k].file);console.log(JSON.stringify({files,bytes:files.reduce((n,f)=>n+fs.statSync('apps/web/dist/'+f).size,0),guide:Object.values(m).some(x=>x.file.includes('Guide-')),monaco:Object.values(m).some(x=>x.file.includes('MonacoEditor-'))}))";
    const assets=spawnSync('docker',['exec',`${env.COMPOSE_PROJECT_NAME}-api-1`,'node','-e',script],{encoding:'utf8'});assert.equal(assets.status,0,assets.stderr);
    const graph=JSON.parse(assets.stdout);assert(graph.guide&&graph.monaco);assert(!graph.files.some((f:string)=>/MonacoEditor|PdfRenderer/.test(f)));assert(graph.bytes<600000);
    for(const file of graph.files){const response=await fetch(`http://127.0.0.1:${env.PF_HTTP_PORT}/${file}`);assert.equal(response.status,200);}
    checks.push('running image ID/commit/build ID and ten migration checksums match','production entry excludes lazy Monaco/PDF, guide chunk present; static JS served');
  }
}
await writeFile(`.local/verify-p7-${label}.json`,JSON.stringify({project:env.COMPOSE_PROJECT_NAME,image:env.PF_APP_IMAGE,checkedAt:new Date().toISOString(),version:operations.version??null,checks},null,2));
console.log(`PASS ${label}: ${checks.join('; ')}`);process.exit(0);
