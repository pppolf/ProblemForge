import {createHash}from'node:crypto';
import {Type,type TSchema}from'@sinclair/typebox';
import {Value}from'@sinclair/typebox/value';
import {isJudgingData}from'@problemforge/contracts';
import {programLanguages,ProgramInput,GeneratorPlanInput,ToolSelfTestInput,ProfileConfig,JudgeSettings,TestGroupsInput,StressConfigInput,DocumentInput,Language,defaultJudgeSettings,generatorPlanCommands,generatorPlanProgramIds,type ProblemManifest,type StoredBlob}from'@problemforge/contracts';
import {PackageError,safePath}from'./archive.ts';import type{Exporter,Purpose,Issue,ImportResult}from'./types.ts';
export const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const strict={additionalProperties:false}, id=Type.String({minLength:1,maxLength:80}),hash=Type.String({pattern:'^[a-f0-9]{64}$'}),version=Type.Integer({minimum:1});
const nullable=(s:TSchema)=>Type.Union([s,Type.Null()]);
// TypeBox's runtime modulo check rejects e.g. 35 % 0.001 due to IEEE-754.
// Preserve the schema's limits and verify milli-point precision explicitly below.
function importSchema(value:any):any{if(Array.isArray(value))return value.map(importSchema);if(value&&typeof value==='object'){const copy={...value};for(const key of Object.keys(copy))copy[key]=importSchema(copy[key]);if(copy.multipleOf===0.001)delete copy.multipleOf;return copy;}return value;}
const blob=Type.Object({key:Type.String({maxLength:200}),hash,bytes:Type.Integer({minimum:0,maximum:8_000_000})},strict);
const test=Type.Object({id,revisionId:id,version,number:Type.Integer({minimum:1,maximum:100000}),groupName:Type.String({pattern:'^[A-Za-z0-9_-]{1,40}$'}),isSample:Type.Boolean(),enabled:Type.Boolean(),notes:Type.String({maxLength:1000}),input:blob,answer:nullable(blob),provenance:Type.Null()},strict);
const manifestSchema=Type.Object({schemaVersion:Type.Literal(1),problemId:id,meta:Type.Object({title:Type.String({minLength:1,maxLength:160}),tags:Type.Array(Type.String({maxLength:40}),{maxItems:30}),notes:Type.String({maxLength:10000}),responsibleId:Type.Null()},strict),
 documents:Type.Array(Type.Object({id,revisionId:id,version,language:Language,kind:Type.Union(['STATEMENT','EDITORIAL_DOCUMENT','EDITORIAL_BEAMER'].map(v=>Type.Literal(v))),enabled:Type.Boolean(),body:DocumentInput.properties.body,metadata:DocumentInput.properties.metadata,sampleRevisionIds:Type.Array(id,{maxItems:10,uniqueItems:true}),template:nullable(Type.Object({id,templateId:id,number:version,hash,name:Type.String({maxLength:120})},strict))},strict),{maxItems:60}),
 programs:Type.Array(Type.Object({...importSchema(Type.Omit(ProgramInput,['profileId'])).properties,id,revisionId:id,version,sourceHash:hash,profile:Type.Object({id,name:Type.String({maxLength:80}),language:Type.Union(programLanguages.map(v=>Type.Literal(v))),version,hash,config:ProfileConfig},strict)},strict),{maxItems:50}),
 tests:Type.Array(test,{maxItems:200}),samples:Type.Array(test,{maxItems:200}),assets:Type.Array(Type.Object({id,name:Type.String({maxLength:120}),path:Type.String({maxLength:200}),mediaType:Type.Union([Type.Literal('image/png'),Type.Literal('image/jpeg')]),blob},strict),{maxItems:100}),
 plans:Type.Array(Type.Object({...GeneratorPlanInput.properties,id,version},strict),{maxItems:100}),selfTests:Type.Array(Type.Object({...Type.Omit(ToolSelfTestInput,['inputBase64','answerBase64','outputBase64']).properties,id,version,input:blob,answer:blob,output:blob},strict),{maxItems:200}),groups:nullable(TestGroupsInput),stress:nullable(StressConfigInput),judgeSettings:JudgeSettings,
},strict);
export function blankManifest(title:string):ProblemManifest{return{schemaVersion:1,problemId:'import',meta:{title,tags:[],notes:'',responsibleId:null},documents:[],programs:[],tests:[],samples:[],assets:[],plans:[],selfTests:[],groups:null,stress:null,judgeSettings:{...defaultJudgeSettings}};}
export function blobs(m:ProblemManifest){return[...m.tests,...m.samples].flatMap(t=>[t.input,...(t.answer?[t.answer]:[])]).concat(m.assets.map(a=>a.blob),m.selfTests.flatMap(s=>[s.input,s.answer,s.output]));}
export function parseJson(bytes:Buffer){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new PackageError('清单必须是有效 UTF-8 JSON');}}
export function validateManifest(m:unknown):asserts m is ProblemManifest{
 if(!Value.Check(manifestSchema,m)){const e=Value.Errors(manifestSchema,m).First();throw new PackageError(`题包清单不符合 v1 约束：${e?.path} ${e?.message}`);}
 const v=m as ProblemManifest;const unique=(ids:string[])=>{if(new Set(ids).size!==ids.length)throw new PackageError('清单 ID / 文稿 / 数据编号重复');};
 unique(v.programs.map(p=>p.id));unique(v.tests.map(t=>t.id));unique(v.tests.map(t=>String(t.number)));unique(v.documents.map(d=>d.language+'/'+d.kind));unique(v.assets.map(a=>a.path));
 const tests=new Map([...v.tests,...v.samples].map(t=>[t.revisionId,t]));
 for(const d of v.documents)if(d.sampleRevisionIds.some(id=>!tests.has(id)))throw new PackageError('样例引用不存在');
 for(const p of v.programs){if(digest(p.source)!==p.sourceHash)throw new PackageError('程序源码哈希不匹配');if(['MAIN_SOLUTION','CORRECT_SOLUTION'].includes(p.role)&&p.expectedVerdicts.join()!=='AC'||p.role==='TIME_LIMIT_SOLUTION'&&p.expectedVerdicts.join()!=='TLE'||p.role==='WRONG_SOLUTION'&&p.expectedVerdicts.includes('AC'))throw new PackageError('解法角色与预期判定冲突');if(p.expectedScore)for(const range of [...p.expectedScore.groups,...(p.expectedScore.total?[p.expectedScore.total]:[])])if(range.min>range.max||[range.min,range.max].some(v=>Math.abs(v*1000-Math.round(v*1000))>1e-7))throw new PackageError('分数范围必须递增且精确到 0.001 分');}
 const role=(id:string,allowed:string[])=>{if(!v.programs.some(p=>p.id===id&&allowed.includes(p.role)))throw new PackageError('配置引用的程序缺失或角色错误');};
 for(const p of v.plans){for(const id of generatorPlanProgramIds(p))role(id,['GENERATOR']);try{generatorPlanCommands(p);}catch(error){throw new PackageError(`生成计划 ${p.name}：${(error as Error).message}`);}}for(const s of v.selfTests)if(s.programId)role(s.programId,s.kind==='CHECKER'?['CHECKER']:['VALIDATOR','EXTRA_VALIDATOR']);
 for(const g of v.groups?.groups??[]){for(const t of g.members)if(!v.tests.some(v=>v.id===t.testId&&v.revisionId===t.revisionId&&v.enabled))throw new PackageError('分组成员不匹配当前启用测试');for(const id of g.extraValidatorIds)role(id,['EXTRA_VALIDATOR']);}
 if(v.stress){role(v.stress.generatorId,['GENERATOR']);role(v.stress.referenceId,['MAIN_SOLUTION','CORRECT_SOLUTION','BRUTE_FORCE']);role(v.stress.candidateId,['MAIN_SOLUTION','CORRECT_SOLUTION','BRUTE_FORCE','WRONG_SOLUTION','TIME_LIMIT_SOLUTION']);if(v.stress.checkerId)role(v.stress.checkerId,['CHECKER']);}
 for(const b of blobs(v))safePath(b.key);for(const a of v.assets)safePath(a.path);
}
// Construct each purpose from an empty package. No full archive is produced then filtered.
export function selectManifest(source:ProblemManifest,purpose:Purpose):ProblemManifest{
 const m=blankManifest(source.meta.title);m.problemId=source.problemId;
 if(purpose==='FULL'){Object.assign(m,structuredClone(source));m.meta.responsibleId=null;}
 else if(['STATEMENT','EDITORIAL_DOCUMENT','EDITORIAL_BEAMER'].includes(purpose)){
  m.documents=structuredClone(source.documents.filter(d=>d.kind===purpose&&d.enabled));
  const refs=new Set(m.documents.flatMap(d=>d.sampleRevisionIds));m.samples=structuredClone(source.samples.filter(s=>refs.has(s.revisionId)));
  m.assets=structuredClone(source.assets.filter(a=>m.documents.some(d=>d.body.includes(a.path))));
 }else if(purpose==='DATA'){m.tests=structuredClone(source.tests.filter(t=>isJudgingData(source.judgeSettings,t)));m.groups=structuredClone(source.groups);m.judgeSettings=structuredClone(source.judgeSettings);m.programs=structuredClone(source.programs.filter(p=>p.enabled&&['CHECKER','VALIDATOR','EXTRA_VALIDATOR','INTERACTOR'].includes(p.role)));}
 else if(purpose==='REFERENCE')m.programs=structuredClone(source.programs.filter(p=>p.enabled&&['MAIN_SOLUTION','CORRECT_SOLUTION'].includes(p.role)));
 for(const t of [...m.tests,...m.samples]){t.provenance=null;if(purpose!=='FULL')t.notes='';}for(const p of m.programs)if(purpose!=='FULL')p.notes='';
 return m;
}
export const nativeExporter:Exporter={id:'NATIVE',async export(source,purpose,read){
 const m=selectManifest(source,purpose),files=new Map<string,Buffer>(),report:Issue[]=[{area:'native',status:'MAPPED',message:`ProblemForge v1；模板仅引用 ID/版本/哈希。${purpose==='FULL'?'完整包导入为私有工作副本，必须重新绑定缺失模板并验收；本地任务定位信息与原成员不迁移。':'此用途包供分发；只有完整包可恢复为工作副本。'}`}];
 if(purpose==='DATA'&&source.judgeSettings.interactionMode==='INTERACTIVE'){
  report.push({area:'samples',status:'MAPPED',message:'交互样例仅用于题面展示，已排除出判题数据包；原生完整包仍保留全部样例。'});
  if(m.groups?.groups.some(g=>g.members.some(member=>!m.tests.some(t=>t.id===member.testId&&t.revisionId===member.revisionId))))report.push({area:'groups',status:'BLOCKED',message:'数据组包含交互样例或其他未导出数据，请更新组成员后重新导出。'});
 }
 for(const b of blobs(m)){const bytes=await read(b.key);if(bytes.length!==b.bytes||digest(bytes)!==b.hash)throw new PackageError('私有资源与固定修订哈希不匹配');b.key=`blobs/${b.hash}`;files.set(b.key,bytes);}
 files.set('problemforge.json',Buffer.from(JSON.stringify({format:'problemforge',version:1,purpose,manifest:m},null,2)));return{files,report};
}};
export function importNative(files:Map<string,Buffer>):ImportResult{
 const doc=files.get('problemforge.json');if(!doc)throw new PackageError('缺少 problemforge.json');const root=parseJson(doc);
 if(root.format!=='problemforge'||root.version!==1||root.purpose!=='FULL'||Object.keys(root).some(k=>!['format','version','purpose','manifest'].includes(k)))throw new PackageError('仅完整的 ProblemForge v1 包可恢复为工作副本');validateManifest(root.manifest);
 for(const b of blobs(root.manifest)){const bytes=files.get(b.key);if(!bytes||bytes.length!==b.bytes||digest(bytes)!==b.hash)throw new PackageError(`资源缺失或哈希不匹配：${b.key}`);}
 return{manifest:root.manifest,report:[{area:'native',status:'MAPPED',message:'已校验清单、原始字节与 SHA-256；成员、发布和验收记录不导入。'}]};
}
