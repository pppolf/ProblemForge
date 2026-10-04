import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { ContestBuildInput, type StoredBlob, type DocumentKind } from '@problemforge/contracts';
import { db, Prisma } from '@problemforge/database';
import { contestAccess, hashObject, HttpError, audit, taskQuota } from '@problemforge/domain';
import { CONTEST_RENDERER_VERSION, POLICY_VERSION, TEX_PROFILE, SAMPLE_RENDERER_VERSION, type ContestRenderInput } from '@problemforge/template-engine';
import { GO_JUDGE_VERSION } from '@problemforge/judge-adapter';
import { authenticate, type Api } from '../app.ts';
import { contestRevision } from './contests.ts';
import { currentContestRevision, currentContestRevisionIds } from './contest-snapshot.ts';
import { scheduleBuild } from './builds.ts';
const Id=Type.Object({id:Type.String()});
export function bundleState(states:string[]){if(states.some(s=>s==='RUNNING'))return 'RUNNING';if(states.some(s=>s==='QUEUED'))return 'QUEUED';if(states.every(s=>s==='SUCCEEDED'))return 'SUCCEEDED';if(states.some(s=>s==='SUCCEEDED'))return 'PARTIAL_FAILED';return states.every(s=>s==='CANCELED')?'CANCELED':'FAILED';}
export async function contestBuildRoutes(app:Api){
  app.post('/api/contests/:id/builds',{preHandler:authenticate,schema:{params:Id,body:ContestBuildInput}},async req=>{
    const {revision,snapshot}=req.body.revisionId?await contestRevision(req.user,req.params.id,req.body.revisionId,true):await currentContestRevision(req.user,req.params.id,req.body.expectedVersion);
    const selected=req.body.subset?snapshot.selection.items.filter(i=>req.body.subset!.includes(i.problemId)):snapshot.selection.items;
    if(!selected.length||req.body.subset&&selected.length!==req.body.subset.length)throw new HttpError(422,'子集必须明确选择冻结清单中的题目');
    const missing=[];
    for(const kind of req.body.kinds)for(const item of selected){const p=snapshot.problems.find(p=>p.problemId===item.problemId)!;const d=p.manifest.documents.find(d=>d.kind===kind&&d.language===snapshot.selection.language);if(!d?.enabled||!d.body.trim())missing.push({code:item.code,kind,problemId:item.problemId});}
    if(missing.length)throw new HttpError(422,'所选资料缺稿，请补齐或显式选择包含完整稿件的题目子集','MISSING_MATERIAL',missing);
    const inputs:{kind:DocumentKind;templateVersionId:string;input:Prisma.InputJsonValue;inputHash:string}[]=[];
    for(const kind of req.body.kinds){
      const template=snapshot.templates[kind];if(!template)throw new HttpError(422,`冻结清单没有绑定 ${kind} 模板`);
      const tv=await db.templateVersion.findUnique({where:{id:template.id}});if(!tv||tv.state==='REVOKED')throw new HttpError(409,'冻结模板已撤回，不能发起新构建');
      const order=kind==='EDITORIAL_BEAMER'?[...selected].sort((a,b)=>a.lectureOrder-b.lectureOrder):selected;
      const assets:({path:string}&StoredBlob)[]=[],samples:{revisionId:string;inputPath:string;answerPath:string;input:StoredBlob;answer:StoredBlob}[]=[];
      const entries:ContestRenderInput['entries']=[];
      for(const item of order){
        const index=snapshot.selection.items.findIndex(i=>i.problemId===item.problemId);const namespace=`p${index+1}`;
        const p=snapshot.problems.find(p=>p.problemId===item.problemId)!.manifest;const d=p.documents.find(d=>d.kind===kind&&d.language===snapshot.selection.language)!;
        const used=p.assets.filter(a=>d.body.includes(a.path));assets.push(...used.map(a=>({path:`${namespace}/${a.path}`,...a.blob})));
        const paths=[];
        for(const [i,id]of d.sampleRevisionIds.entries()){const sample=p.samples.find(s=>s.revisionId===id);if(!sample?.answer)throw new HttpError(422,'冻结样例的输入/答案清单不完整');
          const inputPath=`samples/sample-${i+1}.in`,answerPath=`samples/sample-${i+1}.ans`;paths.push({inputPath,answerPath});samples.push({revisionId:id,inputPath:`${namespace}/${inputPath}`,answerPath:`${namespace}/${answerPath}`,input:sample.input,answer:sample.answer});
        }
        entries.push({namespace,code:item.code,body:d.body,metadata:d.metadata,assetPaths:used.map(a=>a.path),samples:paths,timeLimitMs:p.judgeSettings.timeLimitMs,memoryLimitMb:p.judgeSettings.memoryLimitMb,inputFile:p.judgeSettings.ioMode==='STDIO'?'standard input':p.judgeSettings.inputFile,outputFile:p.judgeSettings.ioMode==='STDIO'?'standard output':p.judgeSettings.outputFile});
      }
      if(assets.reduce((n,a)=>n+a.bytes,0)>32_000_000||entries.reduce((n,e)=>n+Buffer.byteLength(e.body),0)>5_000_000)throw new HttpError(422,'单份比赛资料超过源码或资源上限');
      const s=snapshot.selection;
      const input={kind,mode:'contest',body:'',metadata:{title:s.title,author:s.author},language:s.language,contest:{title:s.title,author:s.author,stage:s.stage,dateHeader:s.dateHeader,dateCover:s.dateCover,entries},files:template.files,templateHash:template.hash,templateNumber:template.number,contentVersion:revision.number,contestRevisionId:revision.id,contestHash:revision.hash,selectedProblemIds:order.map(i=>i.problemId),explicitSubset:!!req.body.subset,assets,samples,
        policy:POLICY_VERSION,toolchain:TEX_PROFILE,sandboxVersion:GO_JUDGE_VERSION,contestRendererVersion:CONTEST_RENDERER_VERSION,...(samples.length?{sampleRendererVersion:SAMPLE_RENDERER_VERSION}:{})};
      inputs.push({kind,templateVersionId:template.id,input:input as unknown as Prisma.InputJsonValue,inputHash:hashObject(input)});
    }
    const bundleId=hashObject([req.user.id,'contest-build',req.body.requestKey??{contestId:req.params.id,inputs:inputs.map(i=>i.inputHash)}]);
    const builds=await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.user.id} FOR UPDATE`;
      const old=await tx.build.findMany({where:{bundleId,retryOfId:null}});
      if(old.length){if(old.length!==inputs.length||old.some(b=>b.contestId!==req.params.id||!inputs.some(i=>i.kind===b.kind&&i.inputHash===b.inputHash)))throw new HttpError(409,'提交键已用于另一份比赛构建');return old;}
      await taskQuota(tx,req.user.id,'tex',inputs.length);
      const result=[];for(const input of inputs)result.push(await tx.build.create({data:{...input,requestKey:hashObject([bundleId,input.kind]),requestedById:req.user.id,contestId:req.params.id,contestRevisionId:revision.id,bundleId,purpose:'CONTEST'}}));return result;
    });for(const b of builds)await scheduleBuild(b.id);await audit(req.user.id,'BUILD_CONTEST',revision.id,{bundleId,kinds:req.body.kinds,subset:req.body.subset??null});return {bundleId,builds};
  });
  app.get('/api/contests/:id/builds',{preHandler:authenticate,schema:{params:Id}},async req=>{
    await contestAccess(req.user,req.params.id);
    const {current,builds}=await db.$transaction(async tx=>({current:await currentContestRevisionIds(tx,req.params.id),builds:await tx.build.findMany({where:{contestId:req.params.id},include:{artifacts:true},orderBy:{createdAt:'desc'},take:100})}),{isolationLevel:'RepeatableRead',timeout:30000});
    const rows=builds.map(b=>{const input=b.input as Record<string,unknown>;return {...b,input:{contentVersion:input.contentVersion,templateNumber:input.templateNumber,explicitSubset:input.explicitSubset,selectedProblemIds:input.selectedProblemIds},stale:!b.contestRevisionId||!current.has(b.contestRevisionId)};});
    const bundles=[...new Set(rows.map(b=>b.bundleId))].map(id=>{const children=rows.filter(b=>b.bundleId===id);const latest=children.filter((b,i)=>children.findIndex(x=>x.kind===b.kind)===i);return {id,state:bundleState(latest.map(b=>b.state)),builds:children};});return bundles;
  });
}
