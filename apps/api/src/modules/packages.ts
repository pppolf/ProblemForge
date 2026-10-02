import{randomUUID}from'node:crypto';import{Type}from'@sinclair/typebox';
import{ExportInput,type ProblemManifest}from'@problemforge/contracts';import{db,Prisma}from'@problemforge/database';
import{problemAccess,contestAccess,hashObject,sha256,HttpError,audit}from'@problemforge/domain';
import{PackageError,readArchive,writeArchive,nativeExporter,polygonExporter,importNative,importPolygon,blobs,validateManifest,type Issue,type ImportResult}from'@problemforge/problem-format';
import{validateBody}from'@problemforge/template-engine';import{groupOrder}from'@problemforge/judge-core';
import{authenticate,storage,type Api}from'../app.ts';import{revisionAccess}from'./revisions.ts';import{contestRevision,type FrozenContest}from'./contests.ts';import{restoreManifest}from'./restore-manifest.ts';import{problemSnapshot}from'./revision-snapshot.ts';
const Id=Type.Object({id:Type.String()}),strict={additionalProperties:false};
const ImportInput=Type.Object({format:Type.Union([Type.Literal('NATIVE'),Type.Literal('POLYGON')]),base64:Type.String({minLength:1,maxLength:32_000_000,pattern:'^[A-Za-z0-9+/]+={0,2}$'}),profileMap:Type.Record(Type.String({maxLength:80}),Type.String({maxLength:80}),{maxProperties:50})},strict);
const ConfirmInput=Type.Object({reportHash:Type.String({pattern:'^[a-f0-9]{64}$'}),title:Type.String({minLength:1,maxLength:160}),acceptWarnings:Type.Literal(true)},strict);
type ImportReport={issues:Issue[];manifest:ProblemManifest;reportHash:string;committedProblemId?:string};
function receiptView(record:{id:string;format:string;createdAt:Date;report:unknown}){const r=record.report as ImportReport;return{id:record.id,format:record.format,createdAt:record.createdAt,reportHash:r.reportHash,issues:r.issues,title:r.manifest.meta.title,committedProblemId:r.committedProblemId??null,counts:{documents:r.manifest.documents.length,programs:r.manifest.programs.length,tests:r.manifest.tests.length},canImport:!r.issues.some(i=>i.status==='BLOCKED')};}
const exportView=(e:{id:string;revisionId:string;purpose:string;format:string;hash:string;bytes:number;report:unknown;createdAt:Date})=>({id:e.id,revisionId:e.revisionId,purpose:e.purpose,format:e.format,hash:e.hash,bytes:e.bytes,report:e.report,createdAt:e.createdAt});
async function exportManifest(manifest:ProblemManifest,purpose:string,format:string,runId:string|null){
 const m=structuredClone(manifest),report:Issue[]=[];
 if((purpose==='DATA'||format==='POLYGON'&&purpose==='FULL')&&runId){const cases=await db.runCase.findMany({where:{runId},orderBy:{number:'asc'}});
  for(const c of cases){let t=m.tests.find(t=>t.enabled&&t.number===c.number&&t.input.hash===c.inputHash);if(!t){const origin=c.origin as {type?:string};if(origin.type!=='GENERATOR')continue;t={id:`generated${c.number}`,revisionId:`generated${c.number}r`,version:1,number:c.number,groupName:c.groupName,isSample:c.isSample,enabled:true,notes:'',input:{key:c.inputKey,hash:c.inputHash,bytes:c.inputBytes},answer:null,provenance:null};m.tests.push(t);}
   if(!t.answer&&c.answerKey)t.answer={key:c.answerKey,hash:c.answerHash!,bytes:c.answerBytes!};}
  report.push({area:'answers',status:'MAPPED',message:`数据和答案固定来自修订绑定的成功验收 ${runId}；没有重新运行程序或改写工作数据。`});
 }
 if(purpose==='DATA'&&m.judgeSettings.interactionMode==='BATCH'&&m.tests.some(t=>t.enabled&&!t.answer))report.push({area:'answers',status:'BLOCKED',message:'部分启用测试没有固定答案，需收集答案并重新冻结后正式发布。'});
 return{manifest:m,report};
}
function imageValid(bytes:Buffer,mediaType:string){if(bytes.length>1_000_000)return false;if(mediaType==='image/png')return bytes.length>=33&&bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'&&bytes.subarray(12,16).toString()==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0&&bytes.readUInt32BE(16)*bytes.readUInt32BE(20)<=16_000_000;return bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.subarray(-2).toString('hex')==='ffd9';}
async function prepareImport(format:'NATIVE'|'POLYGON',files:Map<string,Buffer>,mapping:Record<string,string>):Promise<ImportResult>{
 const profiles=await db.compileProfile.findMany({where:{enabled:true}});const result=format==='NATIVE'?importNative(files):importPolygon(files,profiles as unknown as Parameters<typeof importPolygon>[1]);const {manifest:m,report}=result;
 for(const p of m.programs){const mapped=mapping[p.profile.id];const profile=profiles.find(v=>v.id===mapped&&v.language===p.profile.language)??(!mapped?profiles.find(v=>v.language===p.profile.language&&v.hash===p.profile.hash):undefined);if(!profile){report.push({area:`profile:${p.profile.id}`,status:'BLOCKED',message:`${p.profile.name} 需要显式匹配本地 ${p.profile.language} profile`});continue;}if(profile.hash!==p.profile.hash)report.push({area:'profile',status:'WARNING',message:`${p.name} 按本次显式选择改用 ${profile.name}；必须重新验收`});p.profile=profile as unknown as typeof p.profile;
  // Do not allow imports to bypass regular source-role constraints.
  if(['CHECKER','VALIDATOR','EXTRA_VALIDATOR','INTERACTOR'].includes(p.role)&&p.profile.language==='PYTHON3')report.push({area:'programs',status:'BLOCKED',message:'testlib 工具必须使用本地 C++ profile'});
 }
 for(const a of m.assets){const bytes=files.get(a.blob.key);if(!bytes||!imageValid(bytes,a.mediaType))throw new PackageError(`资源 ${a.path} 不是受支持的有界 PNG/JPEG`);}
 // Convert only referenced, bounded images; other package resources stay quarantined.
 if(format==='POLYGON')for(const d of m.documents){for(const match of d.body.matchAll(/\\includegraphics(?:\[[^\]\r\n]*\])?\{([^{}\r\n]+)\}/g)){
  const path=match[1],bytes=files.get(path);if(!bytes||!/^.*\.(png|jpe?g)$/i.test(path))continue;const mediaType=/\.png$/i.test(path)?'image/png':'image/jpeg';if(!imageValid(bytes,mediaType))continue;
  let asset=m.assets.find(a=>a.blob.key===path);if(!asset){const id=`i${m.assets.length+1}`;asset={id,name:path.slice(-120),path:`assets/${id}.${mediaType==='image/png'?'png':'jpg'}`,mediaType,blob:{key:path,bytes:bytes.length,hash:sha256(bytes)}};m.assets.push(asset);}d.body=d.body.split(path).join(asset.path);
 }}
 for(const d of m.documents){try{validateBody(d.body,d.kind,m.assets.map(a=>a.path));}catch(e){report.push({area:`${d.language}/${d.kind}`,status:'WARNING',message:`正文无法安全转换，已留在隔离原包，工作稿将为空且停用：${(e as Error).message}`});d.body='';d.enabled=false;d.sampleRevisionIds=[];}
  const tv=d.template?await db.templateVersion.findUnique({where:{id:d.template.id},include:{template:true}}):null;if(!tv||tv.state!=='PUBLISHED'||tv.hash!==d.template?.hash||tv.template.kind!==d.kind){report.push({area:'templates',status:'WARNING',message:`${d.language}/${d.kind} 缺少匹配的本地已发布模板，请在工作区显式重选`});d.template=null;}
 }
 // Profiles carry DB bookkeeping fields that are not part of the versioned format.
 for(const p of m.programs){const {id,name,language,version,hash,config}=p.profile;p.profile={id,name,language,version,hash,config};}
 try{validateManifest(m);groupOrder(m.groups?.groups??[]);if(m.groups?.groups.length){const all=m.groups.groups.flatMap(g=>g.members.map(t=>t.testId));if(m.tests.filter(t=>t.enabled).some(t=>!all.includes(t.id)))throw new PackageError('分组必须覆盖所有启用测试');}}catch(e){report.push({area:'manifest',status:'BLOCKED',message:(e as Error).message});}
 return result;
}
export async function packageRoutes(app:Api){
 app.get('/api/imports',{preHandler:authenticate},async req=>(await db.exportArtifact.findMany({where:{requestedById:req.user.id,purpose:'QUARANTINE'},orderBy:{createdAt:'desc'},take:50})).map(receiptView));
 app.get('/api/imports/:id',{preHandler:authenticate,schema:{params:Id}},async req=>{const record=await db.exportArtifact.findUnique({where:{id:req.params.id}});if(!record||record.purpose!=='QUARANTINE'||record.requestedById!==req.user.id)throw new HttpError(404,'导入记录不存在');return receiptView(record);});
 for(const scope of ['problems','contests']as const){const contest=scope==='contests';
  app.get(`/api/${scope}/:id/exports`,{preHandler:authenticate,schema:{params:Id}},async req=>{if(contest)await contestAccess(req.user,req.params.id);else await problemAccess(req.user,req.params.id);return(await db.exportArtifact.findMany({where:contest?{contestId:req.params.id}:{problemId:req.params.id},orderBy:{createdAt:'desc'},take:100})).map(exportView);});
  app.post(`/api/${scope}/:id/exports`,{preHandler:authenticate,schema:{params:Id,body:ExportInput}},async req=>{
   const exporter=req.body.format==='NATIVE'?nativeExporter:polygonExporter;let files:Map<string,Buffer>,report:Issue[]=[];
   if(contest){const {revision:r,snapshot:frozen}=await contestRevision(req.user,req.params.id,req.body.revisionId);files=new Map();
    for(const item of frozen.selection.items){const p=frozen.problems.find(p=>p.problemId===item.problemId)!;const prepared=await exportManifest(p.manifest,req.body.purpose,req.body.format,p.acceptanceRunId);const result=await exporter.export(prepared.manifest,req.body.purpose,key=>storage.get(key));report.push(...[...prepared.report,...result.report].map(v=>({...v,area:item.code+'/'+v.area})));files.set(`problems/${item.code}.zip`,await writeArchive(result.files));}
    files.set('contest.json',Buffer.from(JSON.stringify({format:'problemforge-contest-bundle',version:1,purpose:req.body.purpose,selection:frozen.selection,revision:{id:r.id,number:r.number,hash:r.hash},items:frozen.selection.items.map(i=>({code:i.code,path:`problems/${i.code}.zip`,revisionId:i.revisionId}))},null,2)));
   }else{const r=await revisionAccess(req.user,req.body.revisionId);if(r.problemId!==req.params.id)throw new HttpError(404,'本题修订不存在');if(hashObject(r.manifest)!==r.hash)throw new HttpError(409,'修订清单校验失败');const prepared=await exportManifest(r.manifest as unknown as ProblemManifest,req.body.purpose,req.body.format,r.acceptanceRunId);const result=await exporter.export(prepared.manifest,req.body.purpose,key=>storage.get(key));files=result.files;report=[...prepared.report,...result.report];}
   const bytes=await writeArchive(files),key=`exports/${randomUUID()}`;await storage.put(key,bytes);const row=await db.exportArtifact.create({data:{...(contest?{contestId:req.params.id}:{problemId:req.params.id}),revisionId:req.body.revisionId,requestedById:req.user.id,purpose:req.body.purpose,format:req.body.format,key,hash:sha256(bytes),bytes:bytes.length,report:report as unknown as Prisma.InputJsonValue}});await audit(req.user.id,'EXPORT_PACKAGE',row.id,{purpose:row.purpose,format:row.format});return exportView(row);
  });
 }
 app.get('/api/exports/:id/file',{preHandler:authenticate,schema:{params:Id}},async(req,reply)=>{const e=await db.exportArtifact.findUnique({where:{id:req.params.id}});if(!e)throw new HttpError(404,'题包不存在');if(e.contestId)await contestAccess(req.user,e.contestId);else if(e.problemId)await problemAccess(req.user,e.problemId);else if(e.requestedById!==req.user.id)throw new HttpError(404,'导入隔离包不存在');return reply.type('application/zip').header('Content-Disposition',`attachment; filename="${e.format}-${e.purpose}.zip"`).send(await storage.get(e.key));});
 app.post('/api/imports/inspect',{preHandler:authenticate,bodyLimit:32_100_000,schema:{body:ImportInput}},async req=>{
  const bytes=Buffer.from(req.body.base64,'base64');if(bytes.toString('base64')!==req.body.base64)throw new HttpError(422,'需要规范 Base64');const files=await readArchive(bytes);const result=await prepareImport(req.body.format,files,req.body.profileMap);
  const reportHash=hashObject(result);const report:ImportReport={issues:result.report,manifest:result.manifest,reportHash};const key=`imports/${randomUUID()}`;await storage.put(key,bytes);
  const record=await db.exportArtifact.create({data:{revisionId:'IMPORT',requestedById:req.user.id,purpose:'QUARANTINE',format:`IMPORT_${req.body.format}`,key,hash:sha256(bytes),bytes:bytes.length,report:report as unknown as Prisma.InputJsonValue}});await audit(req.user.id,'INSPECT_IMPORT',record.id);
  return receiptView(record);
 });
 app.post('/api/imports/:id/commit',{preHandler:authenticate,schema:{params:Id,body:ConfirmInput}},async req=>{
  const e=await db.exportArtifact.findUnique({where:{id:req.params.id}});if(!e||e.requestedById!==req.user.id||e.purpose!=='QUARANTINE')throw new HttpError(404,'导入检查不存在');const report=e.report as unknown as ImportReport;
  if(report.reportHash!==req.body.reportHash||report.issues.some(i=>i.status==='BLOCKED'))throw new HttpError(409,'兼容报告已改变或仍有阻塞项，需修正包后重新检查');
  if(report.committedProblemId){await problemAccess(req.user,report.committedProblemId);return{id:report.committedProblemId};}
  const bytes=await storage.get(e.key);if(sha256(bytes)!==e.hash)throw new HttpError(409,'隔离包哈希不匹配');const files=await readArchive(bytes),m=structuredClone(report.manifest);validateManifest(m);
  // Validate every relative byte reference before translating it into private storage.
  for(const b of blobs(m)){let value=files.get(b.key);if(b.bytes===0&&b.hash===sha256(Buffer.alloc(0))&&!value)value=Buffer.alloc(0);if(!value||value.length!==b.bytes||sha256(value)!==b.hash)throw new HttpError(422,'导入文件校验失败');const key=`imports/data/${randomUUID()}`;await storage.put(key,value);b.key=key;}
  const created=await db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "ExportArtifact" WHERE id=${e.id} FOR UPDATE`;const latest=(await tx.exportArtifact.findUniqueOrThrow({where:{id:e.id}})).report as unknown as ImportReport;if(latest.committedProblemId)return{id:latest.committedProblemId};
   const p=await tx.problem.create({data:{title:req.body.title,members:{create:{userId:req.user.id,role:'OWNER'}}}});m.meta.title=req.body.title;await restoreManifest(tx,p.id,m,true);const snapshot=await problemSnapshot(tx,p.id);await tx.problemRevision.create({data:{problemId:p.id,number:1,label:'离线导入（待验收）',...snapshot,manifest:snapshot.manifest as unknown as Prisma.InputJsonValue,createdById:req.user.id}});await tx.exportArtifact.update({where:{id:e.id},data:{report:{...report,committedProblemId:p.id} as unknown as Prisma.InputJsonValue}});return{id:p.id};
  },{timeout:30000,isolationLevel:'Serializable'});await audit(req.user.id,'IMPORT_PRIVATE_PROBLEM',created.id,{receipt:e.id});return created;
 });
}
