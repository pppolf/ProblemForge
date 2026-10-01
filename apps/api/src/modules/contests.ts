import { Type } from '@sinclair/typebox';
import { kinds, ContestInput, ContestFreezeInput, type ContestDataValue, type DocumentKind, type ProblemManifest } from '@problemforge/contracts';
import { db, Prisma } from '@problemforge/database';
import { contestAccess, problemAccess, hashObject, HttpError, audit } from '@problemforge/domain';
import { templateLanguages, type TemplateFiles } from '@problemforge/template-engine';
import { authenticate, type Api } from '../app.ts';
import { owner } from './members.ts';
const Id=Type.Object({id:Type.String()});
export type FrozenContest={schemaVersion:1;selection:ContestDataValue;problems:{problemId:string;revisionId:string;revisionNumber:number;hash:string;judgeHash:string;acceptanceRunId:string;manifest:ProblemManifest}[];templates:Partial<Record<DocumentKind,{id:string;number:number;hash:string;files:TemplateFiles}>>};
export async function contestRevision(user:{id:string;role:string},contestId:string,revisionId:string,write=false){
  await contestAccess(user,contestId,write);const revision=await db.contestRevision.findUnique({where:{id:revisionId}});
  if(!revision||revision.contestId!==contestId)throw new HttpError(404,'比赛冻结版本不存在');
  if(hashObject(revision.data)!==revision.hash)throw new HttpError(409,'冻结清单哈希不匹配');
  return {revision,snapshot:revision.data as unknown as FrozenContest};
}
async function validateSelection(user:{id:string;role:string},data:ContestDataValue,old?:ContestDataValue){
  if(new Set(data.items.map(i=>i.problemId)).size!==data.items.length||new Set(data.items.map(i=>i.code)).size!==data.items.length||new Set(data.items.map(i=>i.lectureOrder)).size!==data.items.length)throw new HttpError(422,'题目、题号和讲解顺序不能重复');
  for(const item of data.items){
    if(!old?.items.some(i=>i.problemId===item.problemId&&i.revisionId===item.revisionId))await problemAccess(user,item.problemId);
    const r=await db.problemRevision.findUnique({where:{id:item.revisionId}});
    if(!r||r.problemId!==item.problemId||r.state!=='FROZEN')throw new HttpError(422,`题号 ${item.code} 需要本题已冻结修订`);
  }
  for(const kind of kinds){const id=data.templates[kind];if(!id)continue;const tv=await db.templateVersion.findUnique({where:{id},include:{template:true}});
    if(!tv||tv.template.kind!==kind||!(tv.state==='PUBLISHED'||old?.templates[kind]===id&&tv.state==='ARCHIVED'))throw new HttpError(422,'请选择本类型已发布的管理员模板');
    if(!templateLanguages(tv.files as TemplateFiles).includes(data.language))throw new HttpError(422,'模板不支持比赛所选语言');
  }
}
export async function contestCompleteness(data:ContestDataValue){
  const rows=[];
  for(const item of data.items){const r=await db.problemRevision.findUnique({where:{id:item.revisionId}});const m=r?.manifest as unknown as ProblemManifest|undefined;
    rows.push({...item,title:m?.meta.title??'修订不存在',revisionNumber:r?.number??null,frozen:r?.state==='FROZEN',materials:Object.fromEntries(kinds.map(kind=>{const d=m?.documents.find(d=>d.kind===kind&&d.language===data.language);return [kind,!!d?.enabled&&!!d.body.trim()];}))});
  }
  return {items:rows,templates:await Promise.all(kinds.map(async kind=>{const id=data.templates[kind];const t=id?await db.templateVersion.findUnique({where:{id}}):null;return {kind,bound:!!t,available:!!t&&['PUBLISHED','ARCHIVED'].includes(t.state),contestCapable:!!t&&(t.files as TemplateFiles)['booklet.tex']?.includes('{{CONTENTS}}')===true};})),canFreeze:rows.length>0&&rows.every(r=>r.frozen&&r.materials.STATEMENT)};
}
export async function contestRoutes(app:Api){
  app.get('/api/contests',{preHandler:authenticate},async req=>db.contest.findMany({where:req.user.role==='ADMIN'?{}:{OR:[{members:{some:{userId:req.user.id}}},{groupMembers:{some:{group:{members:{some:{userId:req.user.id}}}}}}]},select:{id:true,title:true,version:true,archived:true,updatedAt:true},orderBy:{updatedAt:'desc'}}));
  app.post('/api/contests',{preHandler:authenticate,schema:{body:ContestInput}},async req=>{
    if(req.body.expectedVersion!==0)throw new HttpError(409,'新比赛版本从 0 开始');await validateSelection(req.user,req.body.data);
    const contest=await db.contest.create({data:{title:req.body.data.title,data:req.body.data,members:{create:{userId:req.user.id,role:'OWNER'}}}});await audit(req.user.id,'CREATE_CONTEST',contest.id);return contest;
  });
  app.get('/api/contests/:id',{preHandler:authenticate,schema:{params:Id}},async req=>{
    const role=await contestAccess(req.user,req.params.id);const contest=await db.contest.findUniqueOrThrow({where:{id:req.params.id}});const revisions=await db.contestRevision.findMany({where:{contestId:contest.id},select:{id:true,number:true,hash:true,createdAt:true,data:true},orderBy:{number:'desc'}});
    return {...contest,role,completeness:await contestCompleteness(contest.data as ContestDataValue),revisions:revisions.map(({data,...r})=>({...r,current:hashObject((data as unknown as FrozenContest).selection)===hashObject(contest.data)}))};
  });
  app.put('/api/contests/:id',{preHandler:authenticate,schema:{params:Id,body:ContestInput}},async req=>{
    await contestAccess(req.user,req.params.id,true);const old=await db.contest.findUniqueOrThrow({where:{id:req.params.id}});await validateSelection(req.user,req.body.data,old.data as ContestDataValue);
    const changed=await db.contest.updateMany({where:{id:old.id,version:req.body.expectedVersion},data:{title:req.body.data.title,data:req.body.data,version:{increment:1}}});if(!changed.count)throw new HttpError(409,'比赛编排已改变，请重载合并','VERSION_CONFLICT');await audit(req.user.id,'UPDATE_CONTEST',old.id);return db.contest.findUniqueOrThrow({where:{id:old.id}});
  });
  app.post('/api/contests/:id/freeze',{preHandler:authenticate,schema:{params:Id,body:ContestFreezeInput}},async req=>{
    await owner(req.user,req.params.id,true);const result=await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Contest" WHERE id=${req.params.id} FOR UPDATE`;
      const c=await tx.contest.findUniqueOrThrow({where:{id:req.params.id}});if(c.archived)throw new HttpError(409,'已归档比赛不能建立新冻结版本');if(c.version!==req.body.expectedVersion)throw new HttpError(409,'比赛版本冲突');
      const data=c.data as ContestDataValue;if(!data.items.length)throw new HttpError(422,'至少选择一道题目');
      const snapshot:FrozenContest={schemaVersion:1,selection:data,problems:[],templates:{}};
      for(const item of data.items){
        const r=await tx.problemRevision.findUnique({where:{id:item.revisionId}});if(!r||r.problemId!==item.problemId||r.state!=='FROZEN'||hashObject(r.manifest)!==r.hash)throw new HttpError(409,'源题冻结修订不完整');
        const run=r.acceptanceRunId?await tx.testRun.findUnique({where:{id:r.acceptanceRunId}}):null;
        if(!run||run.state!=='SUCCEEDED'||!run.accepted||run.dependencyHash!==r.judgeHash)throw new HttpError(409,'所选题目修订缺少匹配的成功验收');
        const manifest=r.manifest as unknown as ProblemManifest;if(!manifest.documents.some(d=>d.language===data.language&&d.kind==='STATEMENT'&&d.enabled&&d.body.trim()))throw new HttpError(422,`题号 ${item.code} 缺少所选语言的启用题面`);
        snapshot.problems.push({problemId:item.problemId,revisionId:r.id,revisionNumber:r.number,hash:r.hash,judgeHash:r.judgeHash!,acceptanceRunId:run.id,manifest});
      }
      for(const kind of kinds){const id=data.templates[kind];if(!id){if(kind==='STATEMENT')throw new HttpError(422,'请选择比赛题册模板');continue;}
        const tv=await tx.templateVersion.findUniqueOrThrow({where:{id}});const files=tv.files as TemplateFiles;
        if(!['PUBLISHED','ARCHIVED'].includes(tv.state)||!files['booklet.tex']?.includes('{{CONTENTS}}'))throw new HttpError(422,'所选模板尚未提供多题组装入口或已撤回');
        snapshot.templates[kind]={id,number:tv.number,hash:tv.hash,files};
      }
      const last=await tx.contestRevision.findFirst({where:{contestId:c.id},orderBy:{number:'desc'}});return tx.contestRevision.create({data:{contestId:c.id,number:(last?.number??0)+1,data:snapshot as unknown as Prisma.InputJsonValue,hash:hashObject(snapshot),createdById:req.user.id}});
    },{isolationLevel:'Serializable',timeout:30000});await audit(req.user.id,'FREEZE_CONTEST',result.id);return {id:result.id,number:result.number,hash:result.hash};
  });
}
