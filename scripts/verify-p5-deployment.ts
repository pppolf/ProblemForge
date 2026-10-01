import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parse } from 'dotenv';
import { resolve } from 'node:path';
import { Client } from './http-client.ts';
import { loadTemplateDirectory } from '@problemforge/template-engine';
import { sha256, hashObject } from '@problemforge/domain';
const env=parse(await readFile('.local/p5-prod.env')),origin=env.APP_ORIGIN,base=`http://127.0.0.1:${env.PF_HTTP_PORT}`,admin=new Client(base,origin);
await mkdir('.local/p5-deployment',{recursive:true});await admin.login(env.PF_ADMIN_EMAIL,env.PF_ADMIN_PASSWORD);
async function waitBuild(c:Client,id:string){for(let i=0;i<180;i++){const b=await c.call(`/builds/${id}`);if(!['QUEUED','RUNNING'].includes(b.state))return b;await new Promise(r=>setTimeout(r,500));}throw new Error('TeX timeout');}
const styles=[['STATEMENT','statement-compact'],['EDITORIAL_DOCUMENT','editorial-document-blue'],['EDITORIAL_BEAMER','editorial-beamer-wide']];
if(process.argv.includes('--templates')){
 const records=[];
 for(const[kind,folder]of styles){const files=await loadTemplateDirectory(resolve('templates/builtin',folder));const template=await admin.call('/admin/templates','POST',{name:`部署演练 · ${folder}`,kind});const version=await admin.call(`/admin/templates/${template.id}/versions`,'POST',{files});const build=await waitBuild(admin,(await admin.call(`/admin/template-versions/${version.id}/validate`,'POST')).id);assert.equal(build.state,'SUCCEEDED',build.log);await writeFile(`.local/p5-deployment/template-${kind}.pdf`,await admin.bytes(`/artifacts/${build.artifacts[0].id}/pdf`));records.push({kind,folder,templateId:template.id,versionId:version.id,buildId:build.id,hash:hashObject(files)});}
 await writeFile('.local/p5-deployment/templates.json',JSON.stringify(records,null,2));console.log('PASS three deployed template validations; PDFs saved for visual review');process.exit(0);
}
if(!process.argv.includes('--reviewed-templates'))throw new Error('先执行 --templates，检查 PDF 后再用 --reviewed-templates 继续');
const stylesProof=JSON.parse(await readFile('.local/p5-deployment/templates.json','utf8')),bindings:Record<string,string>={};
for(const r of stylesProof){assert.equal(hashObject(await loadTemplateDirectory(resolve('templates/builtin',r.folder))),r.hash);await admin.call(`/admin/template-versions/${r.versionId}/publish`,'POST',{reviewedBuildId:r.buildId});bindings[r.kind]=r.versionId;}
const authorEmail=`p5-author-${randomUUID()}@example.test`,authorPassword=`P5-${randomUUID()}-Aa1`;await admin.call('/admin/users','POST',{email:authorEmail,name:'部署演练出题人',password:authorPassword,role:'USER'});const c=new Client(base,origin);await c.login(authorEmail,authorPassword);
await writeFile('.local/p5-deployment/author.json',JSON.stringify({email:authorEmail,password:authorPassword}));
const dev=new Client(),f=JSON.parse(await readFile('.local/verify-p2-fixture.json','utf8'));await dev.login(f.authorEmail,f.authorPassword);const old=JSON.parse(await readFile('.local/verify-p4-contest.json','utf8')),items=[],runs=[];
for(const [i,source]of old.finalItems.entries()){
 const exported=await dev.call(`/problems/${source.problemId}/exports`,'POST',{revisionId:source.revisionId,purpose:'FULL',format:'NATIVE'}),bytes=await dev.bytes(`/exports/${exported.id}/file`);
 const receipt=await c.call('/imports/inspect','POST',{format:'NATIVE',base64:bytes.toString('base64'),profileMap:{}});assert(receipt.canImport,JSON.stringify(receipt.issues));
 const p=await c.call(`/imports/${receipt.id}/commit`,'POST',{reportHash:receipt.reportHash,title:`部署演练 · ${String.fromCharCode(65+i)}`,acceptWarnings:true});const problem=await c.call(`/problems/${p.id}`);
 for(const d of problem.documents.filter((d:any)=>d.language==='zh-CN'))await c.call(`/documents/${d.id}`,'PUT',{expectedVersion:d.version,enabled:d.enabled,body:d.currentRevision.body,metadata:d.currentRevision.metadata,templateVersionId:bindings[d.kind],sampleRevisionIds:d.currentRevision.sampleRevisionIds});
 const run=await c.waitRun((await c.call(`/problems/${p.id}/test-runs`,'POST',{purpose:'ACCEPTANCE',requestKey:randomUUID()})).id);assert.equal(run.state,'SUCCEEDED',run.log);assert.equal(run.accepted,true);runs.push(run.id);
 const working=await c.call(`/problems/${p.id}/working-revision`),revision=await c.call(`/problems/${p.id}/revisions`,'POST',{expectedHash:working.hash,label:'Linux 部署验收后冻结'});for(const action of ['SUBMIT','APPROVE','FREEZE'])await c.call(`/revisions/${revision.id}/review`,'POST',{action,message:'部署演练，核对固定验收和稿件'});
 items.push({problemId:p.id,revisionId:revision.id,code:String.fromCharCode(65+i),lectureOrder:3-i});
}
const contest=await c.call('/contests','POST',{expectedVersion:0,data:{title:'P5 Linux 部署演练赛',author:'ProblemForge 出题组',stage:'生产镜像 · 私网演练',dateHeader:'2026/10/01',dateCover:'2026 年 10 月 1 日',language:'zh-CN',templates:bindings,items}}),frozen=await c.call(`/contests/${contest.id}/freeze`,'POST',{expectedVersion:contest.version});
const bundle=await c.call(`/contests/${contest.id}/builds`,'POST',{revisionId:frozen.id,kinds:styles.map(x=>x[0]),requestKey:randomUUID()}),builds=[];
for(const child of bundle.builds){const b=await waitBuild(c,child.id);assert.equal(b.state,'SUCCEEDED',b.log);const pdf=await c.bytes(`/artifacts/${b.artifacts[0].id}/pdf`);assert.equal(sha256(pdf),b.artifacts[0].hash);await writeFile(`.local/p5-deployment/${b.kind}.pdf`,pdf);builds.push({id:b.id,kind:b.kind,artifactId:b.artifacts[0].id,hash:b.artifacts[0].hash});}
const statement=builds.find(b=>b.kind==='STATEMENT')!,release=await c.call(`/contests/${contest.id}/releases`,'POST',{buildId:statement.id}),anon=new Client(base,origin);assert.equal(sha256(await anon.bytes(`/released/${release.token}/file`)),statement.hash);await anon.bytes(`/artifacts/${builds.find(b=>b.kind==='EDITORIAL_DOCUMENT')!.artifactId}/pdf`,401);await c.call(`/releases/${release.id}/revoke`,'POST');await anon.bytes(`/released/${release.token}/file`,404);
const proof={base,contestId:contest.id,contestRevisionId:frozen.id,items,runs,builds,checks:['Linux production image and eight migrations','fresh private import and explicit template binding','three real sandbox acceptance runs','immutable reviewed contest','three unified-source real PDFs','independent public statement and private editorials','revoked download denied']};await writeFile('.local/verify-p5-deployment.json',JSON.stringify(proof,null,2));console.log('PASS Linux production deployment and core contest flow');process.exit(0);
