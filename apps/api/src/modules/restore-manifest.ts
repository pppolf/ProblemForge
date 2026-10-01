import { randomUUID } from 'node:crypto';
import { Prisma } from '@problemforge/database';
import { remapGeneratorPlanPrograms, type ProblemManifest, type ManifestTest } from '@problemforge/contracts';
import { hashObject, sha256, HttpError } from '@problemforge/domain';
import { appendTest } from './judge-data.ts';
import { storage } from '../app.ts';

// Writes new working versions. Existing history and review/freeze records survive.
export async function restoreManifest(tx:Prisma.TransactionClient,problemId:string,m:ProblemManifest,copy:boolean) {
  const programIds=new Map<string,string>(),testIds=new Map<string,string>(),revisionIds=new Map<string,string>(),assetPaths=new Map<string,string>();
  const oldPrograms=await tx.program.findMany({where:{problemId},include:{currentRevision:true}});
  const oldTests=await tx.testCase.findMany({where:{problemId,deletedAt:null},include:{currentRevision:true}});
  const oldDocs=await tx.document.findMany({where:{problemId},include:{currentRevision:true}});
  // Reserve test numbers transactionally so rollback can reverse renumberings.
  for(const [i,t] of oldTests.entries())await tx.testCase.update({where:{id:t.id},data:{number:-i-1}});
  for(const p of m.programs){
    const profile=await tx.compileProfile.findUnique({where:{id:p.profile.id}});
    if(!profile||profile.language!==p.profile.language||profile.hash!==p.profile.hash)throw new HttpError(422,`编译 profile ${p.profile.name} 已缺失或改变，需先显式匹配本地 profile`);
    const config={name:p.name,role:p.role,profileId:p.profile.id,expectedVerdicts:p.expectedVerdicts,expectedScore:p.expectedScore??null,validatorScope:p.validatorScope??'GLOBAL',notes:p.notes,enabled:p.enabled};
    const old=copy?undefined:oldPrograms.find(o=>o.id===p.id);
    const data={...config,expectedScore:config.expectedScore??Prisma.DbNull};
    const saved=old?await tx.program.update({where:{id:old.id},data:{...data,version:{increment:1}}}):await tx.program.create({data:{problemId,...data}});
    const revision=await tx.programRevision.create({data:{programId:saved.id,version:saved.version,source:p.source,hash:sha256(p.source),configuration:config}});
    await tx.program.update({where:{id:saved.id},data:{currentRevisionId:revision.id}});programIds.set(p.id,saved.id);
  }
  for(const old of oldPrograms.filter(o=>!m.programs.some(p=>p.id===o.id))){
    const configuration={...old.currentRevision!.configuration as object,enabled:false};
    const r=await tx.programRevision.create({data:{programId:old.id,version:old.version+1,source:old.currentRevision!.source,hash:sha256(old.currentRevision!.source),configuration}});
    await tx.program.update({where:{id:old.id},data:{enabled:false,version:{increment:1},currentRevisionId:r.id}});
  }
  const saveTest=async(t:ManifestTest,old?:{id:string;version:number})=>{
    const id=await appendTest(tx,problemId,{number:t.number,groupName:t.groupName,isSample:t.isSample,enabled:t.enabled,notes:t.notes},t.input,t.answer,{restoredFrom:t.revisionId,source:t.provenance??null} as Prisma.InputJsonValue,old);
    const row=await tx.testCase.findUniqueOrThrow({where:{id}});testIds.set(t.id,id);revisionIds.set(t.revisionId,row.currentRevisionId!);return row;
  };
  for(const t of m.tests){
    let old=copy?undefined:oldTests.find(o=>o.id===t.id);
    // Preserve old sample bytes as actual history before appending the current input.
    if(copy)for(const s of m.samples.filter(s=>s.id===t.id&&s.revisionId!==t.revisionId).sort((a,b)=>a.version-b.version))old=await saveTest({...s,number:t.number},old) as typeof old;
    await saveTest(t,old);
  }
  let nextNumber=Math.max(0,...m.tests.map(t=>t.number),...oldTests.map(t=>t.number))+1;
  for(const old of oldTests.filter(o=>!m.tests.some(t=>t.id===o.id))){
    const r=old.currentRevision!;await appendTest(tx,problemId,{number:nextNumber++,groupName:old.groupName,isSample:old.isSample,enabled:false,notes:old.notes},{key:r.inputKey,hash:r.inputHash,bytes:r.inputBytes},r.answerKey?{key:r.answerKey,hash:r.answerHash!,bytes:r.answerBytes!}:null,{rollbackRetained:true},old);
  }
  if(copy)for(const s of m.samples.filter(s=>!revisionIds.has(s.revisionId)))await saveTest({...s,number:nextNumber++,enabled:false});
  for(const a of m.assets){
    if(!copy){assetPaths.set(a.path,a.path);continue;}
    const bytes=await storage.get(a.blob.key);const key=`assets/${problemId}/${randomUUID()}`;await storage.put(key,bytes);
    const saved=await tx.asset.create({data:{problemId,name:a.name,key,hash:a.blob.hash,bytes:a.blob.bytes,mediaType:a.mediaType}});
    assetPaths.set(a.path,`assets/${saved.id}.${a.mediaType==='image/png'?'png':'jpg'}`);
  }
  for(const d of m.documents){
    let body=d.body;for(const [from,to]of assetPaths)body=body.split(from).join(to);
    const sampleRevisionIds=d.sampleRevisionIds.map(id=>copy?revisionIds.get(id)!:id);
    if(sampleRevisionIds.some(id=>!id))throw new HttpError(422,'样例版本清单不完整');
    const old=oldDocs.find(o=>o.kind===d.kind&&o.language===d.language);
    const tv=d.template?await tx.templateVersion.findUnique({where:{id:d.template.id},include:{template:true}}):null;
    const binding=tv&&tv.hash===d.template!.hash&&tv.template.kind===d.kind&&(copy?tv.state==='PUBLISHED':['PUBLISHED','ARCHIVED'].includes(tv.state))?tv.id:null;
    const doc=old?await tx.document.update({where:{id:old.id},data:{enabled:d.enabled,templateVersionId:binding,version:{increment:1}}}):await tx.document.create({data:{problemId,language:d.language,kind:d.kind,enabled:d.enabled,templateVersionId:binding}});
    const revision=await tx.contentRevision.create({data:{documentId:doc.id,version:doc.version,body,metadata:d.metadata,sampleRevisionIds,hash:hashObject({body,metadata:d.metadata,sampleRevisionIds})}});
    await tx.document.update({where:{id:doc.id},data:{currentRevisionId:revision.id}});
  }
  for(const old of oldDocs.filter(o=>!m.documents.some(d=>d.kind===o.kind&&d.language===o.language))){
    const r=old.currentRevision!;const revision=await tx.contentRevision.create({data:{documentId:old.id,version:old.version+1,body:r.body,metadata:r.metadata!,sampleRevisionIds:r.sampleRevisionIds,hash:r.hash}});
    await tx.document.update({where:{id:old.id},data:{enabled:false,version:{increment:1},currentRevisionId:revision.id}});
  }
  // These structured plans have their own version histories; no shell is imported.
  const oldPlans=await tx.generatorPlan.findMany({where:{problemId}});
  for(const g of m.plans){const {id,version,...value}=g;const data=remapGeneratorPlanPrograms(value,programIds);if(!data.programId)throw new HttpError(422,'生成计划缺少程序');const hash=hashObject(data);const old=copy?undefined:oldPlans.find(o=>o.id===id);
    const saved=old?await tx.generatorPlan.update({where:{id:old.id},data:{programId:data.programId,name:data.name,enabled:data.enabled,version:{increment:1},data,hash}}):await tx.generatorPlan.create({data:{problemId,programId:data.programId,name:data.name,enabled:data.enabled,data,hash}});
    await tx.generatorPlanRevision.create({data:{planId:saved.id,version:saved.version,data,hash}});
  }
  for(const old of oldPlans.filter(o=>!m.plans.some(p=>p.id===o.id))){const data={...old.data as object,enabled:false};const hash=hashObject(data);await tx.generatorPlan.update({where:{id:old.id},data:{enabled:false,version:{increment:1},data,hash}});await tx.generatorPlanRevision.create({data:{planId:old.id,version:old.version+1,data,hash}});}
  const oldSelf=await tx.toolSelfTest.findMany({where:{problemId}});
  for(const s of m.selfTests){const {id,version,...value}=s;const data={...value,programId:s.programId?programIds.get(s.programId)!:null};const hash=hashObject(data);const old=copy?undefined:oldSelf.find(o=>o.id===id);
    const attrs={programId:data.programId,kind:data.kind,name:data.name,expected:data.expected,enabled:data.enabled,data,hash};
    const saved=old?await tx.toolSelfTest.update({where:{id:old.id},data:{...attrs,version:{increment:1}}}):await tx.toolSelfTest.create({data:{problemId,...attrs}});await tx.toolSelfTestRevision.create({data:{selfTestId:saved.id,version:saved.version,data,hash}});
  }
  for(const old of oldSelf.filter(o=>!m.selfTests.some(s=>s.id===o.id))){const data={...old.data as object,enabled:false};const hash=hashObject(data);await tx.toolSelfTest.update({where:{id:old.id},data:{enabled:false,version:{increment:1},data,hash}});await tx.toolSelfTestRevision.create({data:{selfTestId:old.id,version:old.version+1,data,hash}});}
  const groups={groups:(m.groups?.groups??[]).map(g=>({...g,members:g.members.map(t=>({...t,testId:testIds.get(t.testId)!,revisionId:revisionIds.get(t.revisionId)!})),extraValidatorIds:g.extraValidatorIds.map(id=>programIds.get(id)!)}))};
  const group=await tx.testGroupConfig.upsert({where:{problemId},create:{problemId,version:1,data:groups,hash:hashObject(groups)},update:{version:{increment:1},data:groups,hash:hashObject(groups)}});await tx.testGroupConfigRevision.create({data:{problemId,version:group.version,data:groups,hash:group.hash}});
  if(m.stress){const s=m.stress;const data={...s,generatorId:programIds.get(s.generatorId)!,referenceId:programIds.get(s.referenceId)!,candidateId:programIds.get(s.candidateId)!,checkerId:s.checkerId?programIds.get(s.checkerId)!:null};const saved=await tx.stressConfig.upsert({where:{problemId},create:{problemId,version:1,data,hash:hashObject(data)},update:{version:{increment:1},data,hash:hashObject(data)}});await tx.stressConfigRevision.create({data:{problemId,version:saved.version,data,hash:saved.hash}});}
  else if(!copy){const old=await tx.stressConfig.findUnique({where:{problemId}});if(old){const hash=hashObject(null);await tx.stressConfig.update({where:{problemId},data:{data:Prisma.JsonNull,version:{increment:1},hash}});await tx.stressConfigRevision.create({data:{problemId,version:old.version+1,data:Prisma.JsonNull,hash}});}}
  await tx.problem.update({where:{id:problemId},data:{title:m.meta.title,tags:m.meta.tags,notes:m.meta.notes,...(!copy?{responsibleId:m.meta.responsibleId}:{}),judgeSettings:m.judgeSettings,judgeVersion:{increment:1},version:{increment:1}}});
}
