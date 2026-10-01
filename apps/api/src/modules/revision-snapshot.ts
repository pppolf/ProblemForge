import { db, Prisma } from '@problemforge/database';
import { defaultJudgeSettings, type ProblemManifest, type ManifestTest, type ManifestProgram, type ManifestDocument } from '@problemforge/contracts';
import { hashObject } from '@problemforge/domain';
import { judgeSnapshot, dependencyHash, validateJudgeSnapshot } from './judge-snapshot.ts';
import { assetPath } from './assets.ts';

export async function problemSnapshot(tx:Prisma.TransactionClient,problemId:string) {
  const p=await tx.problem.findUniqueOrThrow({where:{id:problemId},include:{
    documents:{include:{currentRevision:true,templateVersion:{include:{template:true}}},orderBy:[{language:'asc'},{kind:'asc'}]},
    programs:{include:{currentRevision:true,profile:true},orderBy:{id:'asc'}},tests:{include:{currentRevision:true},orderBy:{number:'asc'}},
    assets:{orderBy:{id:'asc'}},generatorPlans:{orderBy:{id:'asc'}},selfTests:{orderBy:{id:'asc'}},testGroupConfig:true,stressConfig:true,
  }});
  const test=(id:string,r:NonNullable<typeof p.tests[number]['currentRevision']>):ManifestTest=>{
    const conf=r.configuration as unknown as Pick<ManifestTest,'number'|'groupName'|'isSample'|'enabled'|'notes'>;
    return {id,revisionId:r.id,version:r.version,...conf,input:{key:r.inputKey,hash:r.inputHash,bytes:r.inputBytes},answer:r.answerKey?{key:r.answerKey,hash:r.answerHash!,bytes:r.answerBytes!}:null,provenance:r.provenance};
  };
  const sampleIds=[...new Set(p.documents.flatMap(d=>d.currentRevision?.sampleRevisionIds??[]))];
  const samples=await tx.testCaseRevision.findMany({where:{id:{in:sampleIds},testCase:{problemId}},orderBy:{id:'asc'}});
  const manifest:ProblemManifest={schemaVersion:1,problemId,meta:{title:p.title,tags:p.tags,notes:p.notes,responsibleId:p.responsibleId},
    documents:p.documents.map(d=>({id:d.id,revisionId:d.currentRevisionId!,version:d.version,language:d.language,kind:d.kind,enabled:d.enabled,body:d.currentRevision!.body,metadata:d.currentRevision!.metadata as ManifestDocument['metadata'],sampleRevisionIds:d.currentRevision!.sampleRevisionIds,template:d.templateVersion?{id:d.templateVersion.id,templateId:d.templateVersion.templateId,number:d.templateVersion.number,hash:d.templateVersion.hash,name:d.templateVersion.template.name}:null})),
    programs:p.programs.map(s=>({id:s.id,revisionId:s.currentRevisionId!,version:s.version,name:s.name,role:s.role,source:s.currentRevision!.source,sourceHash:s.currentRevision!.hash,enabled:s.enabled,notes:s.notes,expectedVerdicts:s.expectedVerdicts,expectedScore:s.expectedScore,validatorScope:s.validatorScope,profile:{id:s.profile.id,name:s.profile.name,language:s.profile.language,version:s.profile.version,hash:s.profile.hash,config:s.profile.config}})) as ManifestProgram[],
    tests:p.tests.map(t=>test(t.id,t.currentRevision!)),samples:samples.map(r=>test(r.testCaseId,r)),assets:p.assets.map(a=>({id:a.id,name:a.name,path:assetPath(a),mediaType:a.mediaType,blob:{key:a.key,hash:a.hash,bytes:a.bytes}})),
    plans:p.generatorPlans.map(g=>({...g.data as object,id:g.id,version:g.version})) as ProblemManifest['plans'],selfTests:p.selfTests.map(s=>({...s.data as object,id:s.id,version:s.version})) as ProblemManifest['selfTests'],
    groups:p.testGroupConfig?.data as ProblemManifest['groups']??null,stress:p.stressConfig?.data as ProblemManifest['stress']??null,judgeSettings:p.judgeSettings as ProblemManifest['judgeSettings']??defaultJudgeSettings,
  };
  let judgeHash:string|null=null,acceptanceRunId:string|null=null;
  try {const judge=await judgeSnapshot(tx,problemId,'ACCEPTANCE');validateJudgeSnapshot(judge);judgeHash=dependencyHash(judge);
    acceptanceRunId=(await tx.testRun.findFirst({where:{problemId,purpose:'ACCEPTANCE',state:'SUCCEEDED',accepted:true,dependencyHash:judgeHash},orderBy:{createdAt:'desc'},select:{id:true}}))?.id??null;
  } catch(e){ if(!(e instanceof Error && 'statusCode' in e))throw e; }
  // Binding an admin style is a publication dependency, not an algorithm change.
  const reviewHash=hashObject({judgeHash,programs:manifest.programs,tests:manifest.tests,plans:manifest.plans,selfTests:manifest.selfTests,groups:manifest.groups,settings:manifest.judgeSettings,documents:manifest.documents.map(({id,revisionId,version,template,...d})=>d),assets:manifest.assets.map(a=>({path:a.path,hash:a.blob.hash})),meta:{title:manifest.meta.title}});
  return {manifest,hash:hashObject(manifest),reviewHash,judgeHash,acceptanceRunId};
}
export const readProblemSnapshot=(id:string)=>db.$transaction(tx=>problemSnapshot(tx,id),{isolationLevel:'RepeatableRead'});
export function manifestDiff(before:ProblemManifest,after:ProblemManifest) {
  const changes:{path:string;before:unknown;after:unknown}[]=[];
  function compare(a:unknown,b:unknown,path:string){if(hashObject(a??null)===hashObject(b??null))return;
    if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b))for(const key of new Set([...Object.keys(a),...Object.keys(b)]))compare((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key],path?`${path}.${key}`:key);
    else changes.push({path,before:a??null,after:b??null});
  }compare(before,after,'');return changes;
}
