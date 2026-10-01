import { Type } from '@sinclair/typebox';
import { MemberInput, MemberDelete, UserGroupInput, ProblemMetaInput } from '@problemforge/contracts';
import { db, type Prisma } from '@problemforge/database';
import { problemAccess, problemPermission, contestAccess, HttpError, audit } from '@problemforge/domain';
import { admin, authenticate, type Api } from '../app.ts';
const Id=Type.Object({id:Type.String()});
const userFields={id:true,name:true,email:true} as const;
export async function owner(user:{id:string;role:string},id:string,contest=false) {
  const role=contest?await contestAccess(user,id): (await problemPermission(user,id)).role;
  if(role!=='OWNER')throw new HttpError(403,'只有负责人可以管理成员和发布');
}
export async function memberRoutes(app:Api) {
  app.get('/api/directory',{preHandler:authenticate},async()=>({users:await db.user.findMany({where:{disabled:false},select:userFields,orderBy:{name:'asc'},take:500}),groups:await db.userGroup.findMany({select:{id:true,name:true}})}));
  app.get('/api/admin/groups',{preHandler:admin},async()=>db.userGroup.findMany({include:{members:{include:{user:{select:userFields}}}},orderBy:{name:'asc'}}));
  app.put('/api/admin/groups/:id',{preHandler:admin,schema:{params:Id,body:UserGroupInput}},async req=>{
    const {expectedVersion,userIds,name}=req.body;
    if(await db.user.count({where:{id:{in:userIds},disabled:false}})!==userIds.length)throw new HttpError(422,'用户不存在或已停用');
    const result=await db.$transaction(async tx=>{
      const old=await tx.userGroup.findUnique({where:{id:req.params.id}});
      if((old?.version??0)!==expectedVersion)throw new HttpError(409,'用户组版本已改变');
      if(old){const changed=await tx.userGroup.updateMany({where:{id:old.id,version:expectedVersion},data:{name,version:{increment:1}}});if(!changed.count)throw new HttpError(409,'用户组版本冲突');}
      else await tx.userGroup.create({data:{id:req.params.id,name}});
      await tx.userGroupMember.deleteMany({where:{groupId:req.params.id}});
      await tx.userGroupMember.createMany({data:userIds.map(userId=>({groupId:req.params.id,userId}))});
      return tx.userGroup.findUniqueOrThrow({where:{id:req.params.id},include:{members:true}});
    });await audit(req.user.id,'SAVE_USER_GROUP',result.id);return result;
  });
  for(const scope of ['problems','contests'] as const){
    const contest=scope==='contests';
    app.get(`/api/${scope}/:id/members`,{preHandler:authenticate,schema:{params:Id}},async req=>{
      if(contest)await contestAccess(req.user,req.params.id);else await problemAccess(req.user,req.params.id);
      return contest?{users:await db.contestMember.findMany({where:{contestId:req.params.id},include:{user:{select:userFields}}}),groups:await db.contestGroupMember.findMany({where:{contestId:req.params.id},include:{group:true}})}:
        {users:await db.problemMember.findMany({where:{problemId:req.params.id},include:{user:{select:userFields}}}),groups:await db.problemGroupMember.findMany({where:{problemId:req.params.id},include:{group:true}})};
    });
    app.put(`/api/${scope}/:id/members`,{preHandler:authenticate,schema:{params:Id,body:MemberInput}},async req=>{
      await owner(req.user,req.params.id,contest);
      const {targetId,targetType,role,languages}=req.body;
      if(role==='TRANSLATOR'&&(contest||!languages.length))throw new HttpError(422,'翻译成员需要明确指定题目语言');
      if(role!=='TRANSLATOR'&&languages.length)throw new HttpError(422,'只有翻译成员设置语言范围');
      if(targetType==='GROUP'&&role==='OWNER')throw new HttpError(422,'负责人需为明确用户，不能由用户组间接取得');
      if(targetType==='USER'?!await db.user.findFirst({where:{id:targetId,disabled:false}}):!await db.userGroup.findUnique({where:{id:targetId}}))throw new HttpError(422,'成员目标不存在');
      await db.$transaction(async tx=>{
        await lock(tx,req.params.id,contest);
        if(targetType==='USER'){
          await retainOwner(tx,req.params.id,targetId,role,contest);
          if(contest)await tx.contestMember.upsert({where:{contestId_userId:{contestId:req.params.id,userId:targetId}},create:{contestId:req.params.id,userId:targetId,role},update:{role}});
          else await tx.problemMember.upsert({where:{problemId_userId:{problemId:req.params.id,userId:targetId}},create:{problemId:req.params.id,userId:targetId,role,languages},update:{role,languages}});
        }else if(contest)await tx.contestGroupMember.upsert({where:{contestId_groupId:{contestId:req.params.id,groupId:targetId}},create:{contestId:req.params.id,groupId:targetId,role},update:{role}});
        else await tx.problemGroupMember.upsert({where:{problemId_groupId:{problemId:req.params.id,groupId:targetId}},create:{problemId:req.params.id,groupId:targetId,role,languages},update:{role,languages}});
      });await audit(req.user.id,'GRANT_MEMBER',req.params.id,req.body);return {ok:true};
    });
    app.delete(`/api/${scope}/:id/members`,{preHandler:authenticate,schema:{params:Id,body:MemberDelete}},async req=>{
      await owner(req.user,req.params.id,contest);const {targetId,targetType}=req.body;
      await db.$transaction(async tx=>{await lock(tx,req.params.id,contest);
        if(targetType==='USER'){await retainOwner(tx,req.params.id,targetId,null,contest);if(contest)await tx.contestMember.deleteMany({where:{contestId:req.params.id,userId:targetId}});else await tx.problemMember.deleteMany({where:{problemId:req.params.id,userId:targetId}});}
        else if(contest)await tx.contestGroupMember.deleteMany({where:{contestId:req.params.id,groupId:targetId}});else await tx.problemGroupMember.deleteMany({where:{problemId:req.params.id,groupId:targetId}});
      });await audit(req.user.id,'REVOKE_MEMBER',req.params.id,req.body);return {ok:true};
    });
  }
  app.put('/api/problems/:id/meta',{preHandler:authenticate,schema:{params:Id,body:ProblemMetaInput}},async req=>{
    const permission=await problemPermission(req.user,req.params.id);
    if(!['OWNER','EDITOR'].includes(permission.role))throw new HttpError(403,'需要题目编辑权限');
    if(req.body.archived!==permission.archived&&permission.role!=='OWNER')throw new HttpError(403,'只有负责人可以归档或恢复');
    if(req.body.responsibleId&&!await db.problemMember.findFirst({where:{problemId:req.params.id,userId:req.body.responsibleId,role:{in:['OWNER','EDITOR']}}}))throw new HttpError(422,'负责出题人必须是本题负责人或编辑');
    const {expectedVersion,...data}=req.body;
    const result=await db.problem.updateMany({where:{id:req.params.id,version:expectedVersion},data:{...data,version:{increment:1}}});
    if(!result.count)throw new HttpError(409,'题目元信息已改变，请重载合并');await audit(req.user.id,'UPDATE_PROBLEM_META',req.params.id);return db.problem.findUniqueOrThrow({where:{id:req.params.id}});
  });
}
async function lock(tx:Prisma.TransactionClient,id:string,contest:boolean){if(contest)await tx.$queryRaw`SELECT id FROM "Contest" WHERE id=${id} FOR UPDATE`;else await tx.$queryRaw`SELECT id FROM "Problem" WHERE id=${id} FOR UPDATE`;}
async function retainOwner(tx:Prisma.TransactionClient,id:string,userId:string,role:string|null,contest:boolean){
  if(role==='OWNER')return;
  const owners=contest?await tx.contestMember.findMany({where:{contestId:id,role:'OWNER'}}):await tx.problemMember.findMany({where:{problemId:id,role:'OWNER'}});
  if(owners.length===1&&owners[0].userId===userId)throw new HttpError(409,'至少保留一位直接授权的负责人');
}
