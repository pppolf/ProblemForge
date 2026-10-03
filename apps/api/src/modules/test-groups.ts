import { Type } from '@sinclair/typebox';
import { TestGroupsUpdateInput, defaultJudgeSettings, isJudgingData, type JudgeSettingsValue, type TestGroupsValue } from '@problemforge/contracts';
import { db, type Prisma } from '@problemforge/database';
import { audit, hashObject, HttpError, problemAccess } from '@problemforge/domain';
import { groupOrder, GroupError } from '@problemforge/judge-core';
import { authenticate, type Api } from '../app.ts';
import { lockProblem, touchProblem } from './judge-data.ts';
export async function validateGroups(tx: Prisma.TransactionClient, problemId: string, data: TestGroupsValue) {
  try { groupOrder(data.groups); } catch (e) { if (e instanceof GroupError) throw new HttpError(422,e.message); throw e; }
  if (!data.groups.length) return;
  const problem = await tx.problem.findUniqueOrThrow({where:{id:problemId}});
  const settings = (problem.judgeSettings ?? defaultJudgeSettings) as JudgeSettingsValue;
  const tests = (await tx.testCase.findMany({where:{problemId,enabled:true,deletedAt:null}})).filter(t=>isJudgingData(settings,t));
  const members = data.groups.flatMap(g=>g.members);
  if (tests.length !== members.length || tests.some(t=>!members.some(m=>m.testId===t.id&&m.revisionId===t.currentRevisionId))) throw new HttpError(422,'组成员必须恰好覆盖本题所有参与判题数据的当前版本（交互样例不参与）；删除、停用或更新数据后需显式重选成员');
  for(const id of new Set(data.groups.flatMap(g=>g.extraValidatorIds))) {
    const p=await tx.program.findUnique({where:{id}});
    if(!p||p.problemId!==problemId||p.role!=='EXTRA_VALIDATOR'||!p.enabled||p.validatorScope!=='GROUPS') throw new HttpError(422,'组级 Validator 必须选择本题启用且作用范围为数据组的额外 Validator');
  }
}
export async function groupRoutes(app:Api) {
  const Id=Type.Object({id:Type.String()});
  app.get('/api/problems/:id/test-groups',{preHandler:authenticate,schema:{params:Id}},async req=>{
    await problemAccess(req.user,req.params.id);
    return await db.testGroupConfig.findUnique({where:{problemId:req.params.id}})??{version:0,data:{groups:[]}};
  });
  app.put('/api/problems/:id/test-groups',{preHandler:authenticate,schema:{params:Id,body:TestGroupsUpdateInput}},async req=>{
    await problemAccess(req.user,req.params.id,true);
    const result=await db.$transaction(async tx=>{
      await lockProblem(tx,req.params.id);
      const old=await tx.testGroupConfig.findUnique({where:{problemId:req.params.id}});
      if((old?.version??0)!==req.body.expectedVersion) throw new HttpError(409,'数据组配置版本冲突，本地修改保留','VERSION_CONFLICT');
      await validateGroups(tx,req.params.id,req.body.data);
      const data=req.body.data,version=req.body.expectedVersion+1,hash=hashObject(data);
      const p=await tx.problem.findUniqueOrThrow({where:{id:req.params.id}});
      if((p.judgeSettings as {scoringMode?:string})?.scoringMode==='PARTIAL' && !data.groups.some(g=>g.points>0)) throw new HttpError(422,'部分分配置必须有数据组及正的满分');
      const saved=await tx.testGroupConfig.upsert({where:{problemId:req.params.id},create:{problemId:req.params.id,version,data,hash},update:{version,data,hash}});
      await tx.testGroupConfigRevision.create({data:{problemId:req.params.id,version,data,hash}});await touchProblem(tx,req.params.id);return saved;
    });
    await audit(req.user.id,'SAVE_TEST_GROUPS',req.params.id,{version:result.version});return result;
  });
}
