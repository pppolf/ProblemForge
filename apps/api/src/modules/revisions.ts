import { Type } from '@sinclair/typebox';
import { RevisionInput, ReviewInput, CommentInput, type ProblemManifest } from '@problemforge/contracts';
import { db, Prisma } from '@problemforge/database';
import { problemAccess, HttpError, audit } from '@problemforge/domain';
import { validateBody } from '@problemforge/template-engine';
import { authenticate, type Api } from '../app.ts';
import { owner } from './members.ts';
import { problemSnapshot, readProblemSnapshot, manifestDiff } from './revision-snapshot.ts';
import { restoreManifest } from './restore-manifest.ts';
import { lockProblem } from './judge-data.ts';
const Id=Type.Object({id:Type.String()});
export async function revisionAccess(user:{id:string;role:string},id:string,write=false){const r=await db.problemRevision.findUnique({where:{id}});if(!r)throw new HttpError(404,'修订不存在');await problemAccess(user,r.problemId,write);return r;}
export async function revisionRoutes(app:Api){
  app.get('/api/problems/:id/working-revision',{preHandler:authenticate,schema:{params:Id}},async req=>{await problemAccess(req.user,req.params.id);return readProblemSnapshot(req.params.id);});
  app.get('/api/problems/:id/revisions',{preHandler:authenticate,schema:{params:Id}},async req=>{
    await problemAccess(req.user,req.params.id);const current=await readProblemSnapshot(req.params.id);
    const rows=await db.problemRevision.findMany({where:{problemId:req.params.id},orderBy:{number:'desc'},take:100});
    return rows.map(({manifest,...r})=>({...r,current:r.hash===current.hash,reviewStale:r.reviewHash!==current.reviewHash,acceptanceCurrent:!!current.acceptanceRunId&&r.judgeHash===current.judgeHash}));
  });
  app.post('/api/problems/:id/revisions',{preHandler:authenticate,schema:{params:Id,body:RevisionInput}},async req=>{
    await problemAccess(req.user,req.params.id,true);
    const result=await db.$transaction(async tx=>{await lockProblem(tx,req.params.id);const snapshot=await problemSnapshot(tx,req.params.id);
      if(snapshot.hash!==req.body.expectedHash)throw new HttpError(409,'工作副本已改变，请刷新差异后再保存修订','VERSION_CONFLICT');
      const last=await tx.problemRevision.findFirst({where:{problemId:req.params.id},orderBy:{number:'desc'}});
      const prior=await tx.problemRevision.findFirst({where:{problemId:req.params.id,reviewHash:snapshot.reviewHash,state:{in:['APPROVED','FROZEN']}},orderBy:{number:'desc'}});
      const r=await tx.problemRevision.create({data:{problemId:req.params.id,number:(last?.number??0)+1,label:req.body.label,...snapshot,manifest:snapshot.manifest as unknown as Prisma.InputJsonValue,createdById:req.user.id,state:prior?'APPROVED':'DRAFT'}});
      if(prior)await tx.reviewDecision.create({data:{revisionId:r.id,authorId:req.user.id,action:'CARRY_APPROVAL',message:`内容和判题依赖未变，沿用修订 ${prior.number} 的审核；出版仍需新构建`,reviewHash:r.reviewHash}});
      return r;
    },{isolationLevel:'Serializable'});await audit(req.user.id,'CREATE_PROBLEM_REVISION',result.id);return result;
  });
  app.get('/api/revisions/:id',{preHandler:authenticate,schema:{params:Id}},async req=>{
    const r=await revisionAccess(req.user,req.params.id);return {...r,comments:await db.reviewComment.findMany({where:{revisionId:r.id},orderBy:{createdAt:'asc'}}),decisions:await db.reviewDecision.findMany({where:{revisionId:r.id},orderBy:{createdAt:'asc'}})};
  });
  app.get('/api/revisions/:id/diff',{preHandler:authenticate,schema:{params:Id,querystring:Type.Object({against:Type.Optional(Type.String())},{additionalProperties:false})}},async req=>{
    const r=await revisionAccess(req.user,req.params.id);let target:ProblemManifest;
    if(req.query.against&&req.query.against!=='current'){const other=await revisionAccess(req.user,req.query.against);if(other.problemId!==r.problemId)throw new HttpError(422,'只能比较同题修订');target=other.manifest as unknown as ProblemManifest;}
    else target=(await readProblemSnapshot(r.problemId)).manifest;
    return manifestDiff(r.manifest as unknown as ProblemManifest,target);
  });
  app.post('/api/revisions/:id/comments',{preHandler:authenticate,schema:{params:Id,body:CommentInput}},async req=>{
    const r=await revisionAccess(req.user,req.params.id);const role=await problemAccess(req.user,r.problemId);if(role==='VIEWER')throw new HttpError(403,'只读成员不能评论');
    return db.reviewComment.create({data:{revisionId:r.id,authorId:req.user.id,...req.body}});
  });
  app.put('/api/review-comments/:id',{preHandler:authenticate,schema:{params:Id,body:Type.Object({resolved:Type.Boolean()},{additionalProperties:false})}},async req=>{
    const c=await db.reviewComment.findUnique({where:{id:req.params.id},include:{revision:true}});if(!c)throw new HttpError(404,'评论不存在');const role=await problemAccess(req.user,c.revision.problemId);if(c.authorId!==req.user.id&&!['OWNER','REVIEWER'].includes(role))throw new HttpError(403,'需要评论作者或审题权限');return db.reviewComment.update({where:{id:c.id},data:req.body});
  });
  app.post('/api/revisions/:id/review',{preHandler:authenticate,schema:{params:Id,body:ReviewInput}},async req=>{
    const old=await revisionAccess(req.user,req.params.id);const role=await problemAccess(req.user,old.problemId);const action=req.body.action;
    if(action==='FREEZE')await owner(req.user,old.problemId);else if(!(action==='SUBMIT'?['OWNER','EDITOR']:['OWNER','REVIEWER']).includes(role))throw new HttpError(403,'没有此审核操作权限');
    const result=await db.$transaction(async tx=>{await lockProblem(tx,old.problemId);const r=await tx.problemRevision.findUniqueOrThrow({where:{id:old.id}});const current=await problemSnapshot(tx,r.problemId);
      if((await tx.problem.findUniqueOrThrow({where:{id:r.problemId}})).archived)throw new HttpError(409,'已归档题目不能更改审核状态');
      if(r.state==='FROZEN')throw new HttpError(409,'已冻结修订不可修改审核结论，请建立新修订');
      if(current.reviewHash!==r.reviewHash)throw new HttpError(409,'内容或判题依赖已改变，审核已过期');
      if(action==='SUBMIT'&&!['DRAFT','CHANGES_REQUESTED'].includes(r.state)||['APPROVE','REQUEST_CHANGES'].includes(action)&&r.state!=='SUBMITTED'||action==='FREEZE'&&r.state!=='APPROVED')throw new HttpError(409,'当前审核状态不允许此操作');
      if(action==='FREEZE'){
        if(current.hash!==r.hash)throw new HttpError(409,'工作副本与修订清单不一致，请保存新修订');
        if(!r.judgeHash||!current.acceptanceRunId||current.judgeHash!==r.judgeHash)throw new HttpError(409,'正式冻结需要与本修订匹配的成功验收');
        const m=r.manifest as unknown as ProblemManifest;
        if(!m.documents.some(d=>d.enabled&&d.kind==='STATEMENT'&&d.body.trim()))throw new HttpError(422,'冻结需要至少一种启用且非空的题面');
        for(const d of m.documents.filter(d=>d.enabled))validateBody(d.body,d.kind,m.assets.map(a=>a.path));
      }
      const state={SUBMIT:'SUBMITTED',APPROVE:'APPROVED',REQUEST_CHANGES:'CHANGES_REQUESTED',FREEZE:'FROZEN'}[action];
      await tx.reviewDecision.create({data:{revisionId:r.id,authorId:req.user.id,action,message:req.body.message,reviewHash:r.reviewHash}});
      return tx.problemRevision.update({where:{id:r.id},data:{state,...(action==='FREEZE'?{frozenAt:new Date(),acceptanceRunId:current.acceptanceRunId}:{})}});
    },{isolationLevel:'Serializable'});await audit(req.user.id,action+'_REVISION',old.id);return result;
  });
  app.post('/api/revisions/:id/restore',{preHandler:authenticate,schema:{params:Id,body:RevisionInput}},async req=>{
    const r=await revisionAccess(req.user,req.params.id,true);const result=await db.$transaction(async tx=>{await lockProblem(tx,r.problemId);const before=await problemSnapshot(tx,r.problemId);if(before.hash!==req.body.expectedHash)throw new HttpError(409,'工作副本已改变，不能覆盖','VERSION_CONFLICT');
      await restoreManifest(tx,r.problemId,r.manifest as unknown as ProblemManifest,false);const snapshot=await problemSnapshot(tx,r.problemId);const last=await tx.problemRevision.findFirst({where:{problemId:r.problemId},orderBy:{number:'desc'}});
      return tx.problemRevision.create({data:{problemId:r.problemId,number:last!.number+1,label:req.body.label,...snapshot,manifest:snapshot.manifest as unknown as Prisma.InputJsonValue,createdById:req.user.id}});
    },{timeout:30000,isolationLevel:'Serializable'});await audit(req.user.id,'RESTORE_AS_NEW_REVISION',result.id,{from:r.id});return result;
  });
  app.post('/api/problems/:id/copy',{preHandler:authenticate,schema:{params:Id,body:Type.Object({title:Type.String({minLength:1,maxLength:160})},{additionalProperties:false})}},async req=>{
    await problemAccess(req.user,req.params.id);const result=await db.$transaction(async tx=>{const snapshot=await problemSnapshot(tx,req.params.id);const p=await tx.problem.create({data:{title:req.body.title,members:{create:{userId:req.user.id,role:'OWNER'}}}});snapshot.manifest.meta.title=req.body.title;await restoreManifest(tx,p.id,snapshot.manifest,true);return p;},{timeout:30000,isolationLevel:'RepeatableRead'});await audit(req.user.id,'COPY_PROBLEM',result.id,{source:req.params.id});return result;
  });
}
