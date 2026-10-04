import { Type } from '@sinclair/typebox';
import { kinds, ContestInput, ContestFreezeInput, type ContestDataValue } from '@problemforge/contracts';
import { db, Prisma } from '@problemforge/database';
import { contestAccess, problemAccess, hashObject, HttpError, audit } from '@problemforge/domain';
import { templateLanguages, type TemplateFiles } from '@problemforge/template-engine';
import { authenticate, type Api } from '../app.ts';
import { owner } from './members.ts';
import { liveContestData, contestSources, contestRevisionCurrent, freezeCurrentContest, type FrozenContest } from './contest-snapshot.ts';
export type { FrozenContest } from './contest-snapshot.ts';
const Id=Type.Object({id:Type.String()});
export async function contestRevision(user:{id:string;role:string},contestId:string,revisionId:string,write=false){
  await contestAccess(user,contestId,write);const revision=await db.contestRevision.findUnique({where:{id:revisionId}});
  if(!revision||revision.contestId!==contestId)throw new HttpError(404,'比赛冻结版本不存在');
  if(hashObject(revision.data)!==revision.hash)throw new HttpError(409,'冻结清单哈希不匹配');
  return {revision,snapshot:revision.data as unknown as FrozenContest};
}
async function validateSelection(user:{id:string;role:string},data:ContestDataValue,old?:ContestDataValue){
  if(new Set(data.items.map(i=>i.problemId)).size!==data.items.length||new Set(data.items.map(i=>i.code)).size!==data.items.length||new Set(data.items.map(i=>i.lectureOrder)).size!==data.items.length)throw new HttpError(422,'题目、题号和讲解顺序不能重复');
  for(const item of data.items){
    if(!old?.items.some(i=>i.problemId===item.problemId))await problemAccess(user,item.problemId);
    if(!await db.problem.findUnique({where:{id:item.problemId},select:{id:true}}))throw new HttpError(422,`题号 ${item.code} 的源题不存在`);
  }
  for(const kind of kinds){const id=data.templates[kind];if(!id)continue;const tv=await db.templateVersion.findUnique({where:{id},include:{template:true}});
    if(!tv||tv.template.kind!==kind||!(tv.state==='PUBLISHED'||old?.templates[kind]===id&&tv.state==='ARCHIVED'))throw new HttpError(422,'请选择本类型已发布的管理员模板');
    if(!templateLanguages(tv.files as TemplateFiles).includes(data.language))throw new HttpError(422,'模板不支持比赛所选语言');
  }
}
export async function contestCompleteness(tx:Prisma.TransactionClient,data:ContestDataValue,sources:Awaited<ReturnType<typeof contestSources>>){
  const rows=[];
  for(const item of data.items){const source=sources.get(item.problemId);const m=source?.manifest;
    rows.push({...item,title:m?.meta.title??'源题不存在',hash:source?.hash??null,acceptanceCurrent:!!source?.acceptanceRunId,materials:Object.fromEntries(kinds.map(kind=>{const d=m?.documents.find(d=>d.kind===kind&&d.language===data.language);return [kind,!!d?.enabled&&!!d.body.trim()];}))});
  }
  return {items:rows,templates:await Promise.all(kinds.map(async kind=>{const id=data.templates[kind];const t=id?await tx.templateVersion.findUnique({where:{id}}):null;return {kind,bound:!!t,available:!!t&&['PUBLISHED','ARCHIVED'].includes(t.state),contestCapable:!!t&&(t.files as TemplateFiles)['booklet.tex']?.includes('{{CONTENTS}}')===true};})),canFreeze:rows.length>0&&rows.every(r=>r.acceptanceCurrent&&r.materials.STATEMENT)};
}
export async function contestRoutes(app:Api){
  app.get('/api/contests',{preHandler:authenticate},async req=>db.contest.findMany({where:req.user.role==='ADMIN'?{}:{OR:[{members:{some:{userId:req.user.id}}},{groupMembers:{some:{group:{members:{some:{userId:req.user.id}}}}}}]},select:{id:true,title:true,version:true,archived:true,updatedAt:true},orderBy:{updatedAt:'desc'}}));
  app.post('/api/contests',{preHandler:authenticate,schema:{body:ContestInput}},async req=>{
    if(req.body.expectedVersion!==0)throw new HttpError(409,'新比赛版本从 0 开始');await validateSelection(req.user,req.body.data);
    const contest=await db.contest.create({data:{title:req.body.data.title,data:liveContestData(req.body.data),members:{create:{userId:req.user.id,role:'OWNER'}}}});await audit(req.user.id,'CREATE_CONTEST',contest.id);return contest;
  });
  app.get('/api/contests/:id',{preHandler:authenticate,schema:{params:Id}},async req=>{
    const role=await contestAccess(req.user,req.params.id);
    return db.$transaction(async tx=>{
      const contest=await tx.contest.findUniqueOrThrow({where:{id:req.params.id}});const data=liveContestData(contest.data as ContestDataValue),sources=await contestSources(tx,data);
      const revisions=await tx.contestRevision.findMany({where:{contestId:contest.id},select:{id:true,number:true,hash:true,createdAt:true,data:true},orderBy:{number:'desc'}});
      return {...contest,data,role,completeness:await contestCompleteness(tx,data,sources),revisions:revisions.map(r=>{const frozen=r.data as unknown as FrozenContest;return {id:r.id,number:r.number,hash:r.hash,createdAt:r.createdAt,current:contestRevisionCurrent(r,data,sources),items:frozen.selection.items.map(i=>({problemId:i.problemId,code:i.code,title:frozen.problems.find(p=>p.problemId===i.problemId)?.manifest.meta.title??i.problemId}))};})};
    },{isolationLevel:'RepeatableRead',timeout:30000});
  });
  app.put('/api/contests/:id',{preHandler:authenticate,schema:{params:Id,body:ContestInput}},async req=>{
    await contestAccess(req.user,req.params.id,true);const old=await db.contest.findUniqueOrThrow({where:{id:req.params.id}});await validateSelection(req.user,req.body.data,old.data as ContestDataValue);
    const result=await db.$transaction(async tx=>{const changed=await tx.contest.updateMany({where:{id:old.id,version:req.body.expectedVersion},data:{title:req.body.data.title,data:liveContestData(req.body.data),version:{increment:1}}});if(!changed.count)throw new HttpError(409,'比赛编排已改变，请重载合并','VERSION_CONFLICT');return tx.contest.findUniqueOrThrow({where:{id:old.id}});});await audit(req.user.id,'UPDATE_CONTEST',old.id);return result;
  });
  app.post('/api/contests/:id/freeze',{preHandler:authenticate,schema:{params:Id,body:ContestFreezeInput}},async req=>{
    await owner(req.user,req.params.id,true);
    const {revision}=await db.$transaction(tx=>freezeCurrentContest(tx,req.params.id,req.user.id,req.body.expectedVersion),{isolationLevel:'Serializable',timeout:30000});
    return {id:revision.id,number:revision.number,hash:revision.hash};
  });
}
