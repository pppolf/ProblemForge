import assert from 'node:assert/strict';
import {randomUUID}from'node:crypto';
import {readFile,writeFile,mkdir}from'node:fs/promises';
import {kinds}from'@problemforge/contracts';
import {Client}from'./http-client.ts';
const c=new Client(),f=JSON.parse(await readFile('.local/verify-p2-fixture.json','utf8'));await c.login(f.authorEmail,f.authorPassword);
const templates=await c.call('/templates');
const names={STATEMENT:'简洁蓝色题面',EDITORIAL_DOCUMENT:'蓝色书面题解',EDITORIAL_BEAMER:'宽屏讲解 · 16:9'};
const bindings=Object.fromEntries(kinds.map(k=>[k,templates.find((t:any)=>t.template.name===names[k]&&t.contestCapable)?.id]));assert(kinds.every(k=>bindings[k]),'先验证、预览并发布 P4 模板');
const groups=JSON.parse(await readFile('.local/verify-p3-groups.json','utf8')),interactive=JSON.parse(await readFile('.local/verify-p3-interaction.json','utf8')),files=JSON.parse(await readFile('.local/p3-migration/p2-evidence/verify-p2-results.json','utf8'));
const sources=[groups.problemId,interactive.problemId,files.fileProblemId],titles=['分组求和','交互翻倍','文件求和'],items:any[]=[],records:any[]=[];
async function saveDoc(d:any,body:string,templateVersionId=d.templateVersionId){return c.call(`/documents/${d.id}`,'PUT',{expectedVersion:d.version,enabled:true,body,metadata:d.currentRevision.metadata,templateVersionId,sampleRevisionIds:d.currentRevision.sampleRevisionIds});}
async function freeze(problemId:string,label:string){const working=await c.call(`/problems/${problemId}/working-revision`);const r=await c.call(`/problems/${problemId}/revisions`,'POST',{expectedHash:working.hash,label});/review`,'POST',{action:'SUBMIT',message:'P4 资料验证'});await c.call(`/revisions/${r.id}/review`,'POST',{action:'APPROVE',message:'核对当前内容与验收快照'});}return c.call(`/revisions/${r.id}/freeze`,'POST',{});}
async function waitBuild(id:string){const deadline=Date.now()+100000;while(Date.now()<deadline){const b=await c.call(`/builds/${id}`);if(['SUCCEEDED','FAILED','CANCELED'].includes(b.state))return b;await new Promise(r=>setTimeout(r,500));}throw new Error('TeX build timeout');}
for(let i=0;i<3;i++){
 const p=await c.call(`/problems/${sources[i]}/copy`,'POST',{title:titles[i]});const workspace=await c.call(`/problems/${p.id}`);
 for(const d of workspace.documents.filter((d:any)=>d.language==='zh-CN')){
  d.currentRevision.metadata={title:titles[i],author:'ProblemForge 出题组'};
  const body=d.kind==='STATEMENT'?(i===1?'这是一道交互题。交互器先发送一个整数 $n$，请输出 $2n$ 并刷新输出缓冲区。\n\\Interaction\n选手通过标准输入输出与交互器通信。输出答案后结束程序。':'给定两个整数 $a,b$，求它们的和。\n\\InputFile\n一行包含两个整数。\n\\OutputFile\n输出一个整数 $a+b$。\n\\Note\n使用足够宽的整数类型。'):
   d.kind==='EDITORIAL_DOCUMENT'?`\\section*{算法思路}\n${i===1?'读取 $n$ 并输出 $2n$，及时 flush。':'读取两个整数并相加。'}\n\\section*{正确性证明}\n直接执行题目定义的运算，因此结果正确。\n\\section*{复杂度}\n时间和额外空间均为 $O(1)$。`:
   `\\begin{frame}{${titles[i]}：算法}\n\\begin{block}{核心步骤}\n${i===1?'输出 $2n$ 并刷新缓冲区。':'用 64 位整数计算 $a+b$。'}\n\\end{block}\n\\end{frame}\n\\begin{frame}{正确性与复杂度}\n直接对应定义。时间和空间均为 $O(1)$。\n\\end{frame}`;
  await saveDoc(d,body,bindings[d.kind]);
 }
 const run=await c.waitRun((await c.call(`/problems/${p.id}/test-runs`,'POST',{purpose:'ACCEPTANCE',requestKey:randomUUID()})).id);assert.equal(run.state,'SUCCEEDED',run.log);assert.equal(run.accepted,true,JSON.stringify(run.report));
 const r=await freeze(p.id,`${titles[i]} 初始冻结`);items.push({problemId:p.id,revisionId:r.id,code:String.fromCharCode(65+i),lectureOrder:3-i});records.push({problemId:p.id,revisionId:r.id,runId:run.id});console.log('Frozen problem:',titles[i]);
}
let data={title:'ProblemForge 三题示例赛',author:'ProblemForge 出题组',stage:'P4 阶段验证',dateHeader:'2026/10/01',dateCover:'2026 年 10 月 1 日',language:'zh-CN',templates:bindings,items};
let contest=await c.call('/contests','POST',{expectedVersion:0,data});let frozen=await c.call(`/contests/${contest.id}/freeze`,'POST',{expectedVersion:contest.version});
const first=await c.call(`/contests/${contest.id}/builds`,'POST',{revisionId:frozen.id,kinds:[...kinds]});const built=[];
await mkdir('.local/p4-contest',{recursive:true});
for(const child of first.builds){const b=await waitBuild(child.id);assert.equal(b.state,'SUCCEEDED',b.log);built.push(b);await writeFile(`.local/p4-contest/${b.kind}.pdf`,await c.bytes(`/artifacts/${b.artifacts[0].id}/pdf`));}
assert.deepEqual(built.find(b=>b.kind==='EDITORIAL_BEAMER').input.contest.entries.map((e:any)=>e.code),['C','B','A']);
// Source edits cannot drift the selected frozen revision or its prior PDF.
const old=await c.call(`/problems/${items[0].problemId}`);const statement=old.documents.find((d:any)=>d.kind==='STATEMENT'&&d.language==='zh-CN');await saveDoc(statement,statement.currentRevision.body+'\n仅工作副本追加。');
assert.equal((await c.call(`/contests/${contest.id}`)).revisions[0].current,true);
assert.equal((await c.call(`/builds/${built[0].id}`)).input.contest.entries[0].body.includes('仅工作副本'),false);
const release=await c.call(`/contests/${contest.id}/releases`,'POST',{buildId:built.find(b=>b.kind==='STATEMENT').id});const anon=new Client();const pdf=await anon.bytes(`/released/${release.token}/file`);assert(pdf.subarray(0,5).equals(Buffer.from('%PDF-')));
await anon.bytes(`/artifacts/${built.find(b=>b.kind==='EDITORIAL_DOCUMENT').artifacts[0].id}/pdf`,401);
await c.call(`/releases/${release.id}/revoke`,'POST');await anon.bytes(`/released/${release.token}/file`,404);
// Save a syntactically allowed but genuinely non-compiling Beamer body.
const target=await c.call(`/problems/${items[2].problemId}`);const beamer=target.documents.find((d:any)=>d.kind==='EDITORIAL_BEAMER'&&d.language==='zh-CN');const goodBody=beamer.currentRevision.body;
await saveDoc(beamer,'\\begin{frame}{错误稿验证}\n\\begin{tabular}{c}\na & b \\\\\n\\end{tabular}\n\\end{frame}');const badRevision=await freeze(items[2].problemId,'用于验证子任务部分失败');
data={...data,items:items.map((it,i)=>i===2?{...it,revisionId:badRevision.id}:it)};contest=await c.call(`/contests/${contest.id}`,'PUT',{expectedVersion:contest.version,data});frozen=await c.call(`/contests/${contest.id}/freeze`,'POST',{expectedVersion:contest.version});
const partial=await c.call(`/contests/${contest.id}/builds`,'POST',{revisionId:frozen.id,kinds:['EDITORIAL_DOCUMENT','EDITORIAL_BEAMER']});const partialResults=[];for(const b of partial.builds)partialResults.push(await waitBuild(b.id));assert.equal(partialResults.find(b=>b.kind==='EDITORIAL_DOCUMENT').state,'SUCCEEDED');assert.equal(partialResults.find(b=>b.kind==='EDITORIAL_BEAMER').state,'FAILED');
assert.equal((await c.call(`/contests/${contest.id}/builds`)).find((b:any)=>b.id===partial.bundleId).state,'PARTIAL_FAILED');
const latest=await c.call(`/problems/${items[2].problemId}`);await saveDoc(latest.documents.find((d:any)=>d.id===beamer.id),goodBody);const fixed=await freeze(items[2].problemId,'修正讲解稿');
data={...data,items:items.map((it,i)=>i===2?{...it,revisionId:fixed.id}:it)};contest=await c.call(`/contests/${contest.id}`,'PUT',{expectedVersion:contest.version,data});frozen=await c.call(`/contests/${contest.id}/freeze`,'POST',{expectedVersion:contest.version});
await c.call(`/contests/${contest.id}/releases`,'POST',{buildId:built[0].id},409);
const final=await c.call(`/contests/${contest.id}/builds`,'POST',{revisionId:frozen.id,kinds:[...kinds]});const finalBuilds=[];
for(const child of final.builds){const b=await waitBuild(child.id);assert.equal(b.state,'SUCCEEDED',b.log);finalBuilds.push({id:b.id,kind:b.kind,artifactId:b.artifacts[0].id,hash:b.artifacts[0].hash,bytes:b.artifacts[0].bytes});await writeFile(`.local/p4-contest/${b.kind}.pdf`,await c.bytes(`/artifacts/${b.artifacts[0].id}/pdf`));}
await writeFile('.local/verify-p4-contest.json',JSON.stringify({contestId:contest.id,contestRevisionId:frozen.id,bundleId:final.bundleId,problems:records,finalItems:data.items,builds:finalBuilds,partialBundleId:partial.bundleId,checks:['three distinct real Judge fixtures','frozen source manifests','three real unified-source PDFs','reversed lecture order keeps contest codes','source edit does not drift freeze','public statement does not expose editorial','revoke denies new download','two editorial tasks preserve partial failure','changed selection refuses old release','corrected independent builds']},null,2));
console.log('PASS P4 three-problem contest, fixed revisions, actual PDFs, independent releases and composite partial failure.');process.exit(0);
