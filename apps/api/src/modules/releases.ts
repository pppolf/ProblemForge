import { Type } from '@sinclair/typebox';
import { ReleaseInput, type ContestDataValue } from '@problemforge/contracts';
import { db } from '@problemforge/database';
import { contestAccess, problemAccess, hashObject, token, HttpError, audit } from '@problemforge/domain';
import { authenticate, storage, type Api } from '../app.ts';
import { owner } from './members.ts';
import { problemSnapshot } from './revision-snapshot.ts';
import { contestSources, contestRevisionCurrent } from './contest-snapshot.ts';
const Id=Type.Object({id:Type.String()});
export async function releaseRoutes(app:Api){
  for(const scope of ['problems','contests'] as const){const contest=scope==='contests';
    app.get(`/api/${scope}/:id/releases`,{preHandler:authenticate,schema:{params:Id}},async req=>{
      if(contest)await contestAccess(req.user,req.params.id);else await problemAccess(req.user,req.params.id);
      return db.release.findMany({where:contest?{contestId:req.params.id}:{problemId:req.params.id},orderBy:{createdAt:'desc'}});
    });
    app.post(`/api/${scope}/:id/releases`,{preHandler:authenticate,schema:{params:Id,body:ReleaseInput}},async req=>{
      await owner(req.user,req.params.id,contest);
      if(!!req.body.buildId===!!req.body.exportId)throw new HttpError(422,'请选择一个成功 PDF 或导出包');
      const release=await db.$transaction(async tx=>{
      if(contest)await tx.$queryRaw`SELECT id FROM "Contest" WHERE id=${req.params.id} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM "Problem" WHERE id=${req.params.id} FOR UPDATE`;
      const target=contest?await tx.contest.findUniqueOrThrow({where:{id:req.params.id}}):await tx.problem.findUniqueOrThrow({where:{id:req.params.id}});
      if(target.archived)throw new HttpError(409,'已归档对象不能新建公开发布');
      let purpose:string,artifactId:string|undefined,exportId:string|undefined;
      if(req.body.buildId){
        if(!contest)throw new HttpError(422,'单题 PDF 请使用对应稿件的独立发布入口');
        const b=await tx.build.findUnique({where:{id:req.body.buildId},include:{artifacts:true}});const c=await tx.contest.findUniqueOrThrow({where:{id:req.params.id}});
        const r=b?.contestRevisionId?await tx.contestRevision.findUnique({where:{id:b.contestRevisionId}}):null;
        const tv=b?await tx.templateVersion.findUnique({where:{id:b.templateVersionId}}):null;
        if(!b||b.contestId!==c.id||b.state!=='SUCCEEDED'||!b.artifacts.length||!r||!contestRevisionCurrent(r,c.data as ContestDataValue,await contestSources(tx,c.data as ContestDataValue))||tv?.state==='REVOKED')throw new HttpError(409,'只能发布与比赛及题目最新内容匹配的成功构建，请重新生成资料');
        purpose=b.kind;artifactId=b.artifacts[0].id;
      }else{
        const e=await tx.exportArtifact.findUnique({where:{id:req.body.exportId}});if(!e||(contest?e.contestId:e.problemId)!==req.params.id||!['NATIVE','POLYGON'].includes(e.format))throw new HttpError(404,'导出包不存在');
        if(Array.isArray(e.report)&&e.report.some(i=>i&&typeof i==='object'&&!Array.isArray(i)&&i.status==='BLOCKED'))throw new HttpError(409,'兼容报告含未解决的判题语义项，只能私下下载处理，不能正式发布');
        if(contest){const c=await tx.contest.findUniqueOrThrow({where:{id:req.params.id}});const r=await tx.contestRevision.findUnique({where:{id:e.revisionId}});if(!r||!contestRevisionCurrent(r,c.data as ContestDataValue,await contestSources(tx,c.data as ContestDataValue)))throw new HttpError(409,'导出包与比赛及题目最新内容不一致，请重新生成题包');}
        else {const r=await tx.problemRevision.findUnique({where:{id:e.revisionId}});if(!r||r.state!=='FROZEN')throw new HttpError(409,'正式发布题目包需要已冻结修订');if((await problemSnapshot(tx,req.params.id)).hash!==r.hash)throw new HttpError(409,'导出包与当前工作副本不一致，请重新固定修订');}
        purpose=e.purpose;exportId=e.id;
      }
      return tx.release.create({data:{...(contest?{contestId:req.params.id}:{problemId:req.params.id}),purpose,artifactId,exportId,token:token()}});
      },{isolationLevel:'Serializable',timeout:30000});await audit(req.user.id,'PUBLISH_MATERIAL',release.id,{purpose:release.purpose});return release;
    });
  }
  app.post('/api/releases/:id/revoke',{preHandler:authenticate,schema:{params:Id}},async req=>{
    const r=await db.release.findUnique({where:{id:req.params.id}});if(!r)throw new HttpError(404,'发布不存在');await owner(req.user,(r.contestId??r.problemId)!,!!r.contestId);await db.release.update({where:{id:r.id},data:{revokedAt:new Date()}});await audit(req.user.id,'REVOKE_MATERIAL',r.id);return {ok:true};
  });
  app.get('/api/released/:token/file',{schema:{params:Type.Object({token:Type.String()})}},async(req,reply)=>{
    const release=await db.release.findUnique({where:{token:req.params.token},include:{exported:true}});if(!release||release.revokedAt)throw new HttpError(404,'材料未发布或已撤回');
    const artifact=release.artifactId?await db.artifact.findUnique({where:{id:release.artifactId}}):null;const file=artifact??release.exported;if(!file)throw new HttpError(404,'材料不存在');
    return reply.type(artifact?'application/pdf':'application/zip').header('Content-Disposition',`attachment; filename="${release.purpose}.${artifact?'pdf':'zip'}"`).send(await storage.get(file.key));
  });
}
