import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config, hashPassword, sha256, token } from '@problemforge/domain';
import { db } from '@problemforge/database';
import { snapshot, mergeSaved, draftSignature, downloadDraft, draftExport } from '../apps/web/src/draft-state.ts';

// A delayed reply must advance the base version without replacing later typing.
const submitted={version:1,body:'sent',metadata:{title:'old',author:'old'}};
const current={version:1,body:'typed during save',metadata:{title:'local title',author:'old'}};
const saved={version:2,body:'sent',metadata:{title:'old',author:'normalized author'}};
assert.deepEqual(mergeSaved(current,submitted,saved),{version:2,body:'typed during save',metadata:{title:'local title',author:'normalized author'}});
assert.equal(current.version,1);assert.equal(submitted.body,'sent');
assert.deepEqual(mergeSaved({source:'new typing'},{source:'sent'},{source:'sent',id:'new-id',version:1}),{source:'new typing',id:'new-id',version:1});
const template=mergeSaved({files:{'main.tex':'typing'}},{files:{'main.tex':'sent','style.tex':'old'}},{files:{'main.tex':'sent','style.tex':'generated','new.tex':'server'}});
assert.deepEqual(template,{files:{'main.tex':'typing','new.tex':'server'}});
assert.deepEqual(mergeSaved({files:{main:'typing',style:'old'}},{files:{main:'sent',style:'old'}},{files:{main:'sent',style:'generated'}}),{files:{main:'typing',style:'generated'}});
assert.deepEqual(mergeSaved({version:1,items:['B','A']},{version:1,items:['A','B']},{version:2,items:['A','B']}),{version:2,items:['B','A']});
assert.equal(draftSignature({b:1,a:{d:2,c:3}}),draftSignature({a:{c:3,d:2},b:1}));
const cloned=snapshot(submitted);cloned.metadata.title='separate';assert.equal(submitted.metadata.title,'old');
downloadDraft('conflict',current);assert.deepEqual(JSON.parse(draftExport.value!.json).data,current);draftExport.value=null;
if(process.argv.includes('--logic-only')) { console.log('PASS delayed save reconciliation and local export payload'); process.exit(0); }

if(!process.argv.includes('--isolated')){
  const url=new URL(process.env.DATABASE_URL!),database=`problemforge_p62_verify_${randomUUID().replaceAll('-','').slice(0,12)}`;
  await db.$executeRawUnsafe(`CREATE DATABASE "${database}"`);await db.$disconnect();url.pathname='/'+database;
  for(const args of [['scripts/database.ts','migrate'],[fileURLToPath(import.meta.url),'--isolated']]){const r=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',...args],{env:{...process.env,DATABASE_URL:url.toString()},stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}process.exit(0);
}
const database=new URL(process.env.DATABASE_URL!).pathname;assert.match(database,/^\/problemforge_p62_verify_[a-f0-9]{12}$/);
const {createApp}=await import('../apps/api/src/app.ts');const app=await createApp(false);
try{
  const user=await db.user.create({data:{email:'editor@verify.invalid',name:'Editor',role:'ADMIN',passwordHash:await hashPassword(token())}}),raw=token(),csrf=token();
  await db.session.create({data:{id:sha256(raw),userId:user.id,csrfToken:csrf,expiresAt:new Date(Date.now()+3600000)}});
  async function call(path:string,method:'GET'|'POST'|'PUT'='GET',payload?:object){const r=await app.inject({method,url:'/api'+path,headers:{origin:config.origin,cookie:'pf_session='+raw,'x-csrf-token':csrf},...(payload?{payload}: {})});return {status:r.statusCode,data:r.json()};}
  const starter=await call('/admin/template-starters/STATEMENT');assert.equal(starter.status,200);
  const t=await call('/admin/templates','POST',{name:'P6.2 CAS fixture',kind:'STATEMENT'});assert.equal(t.status,200);
  const initial=await call('/admin/templates/'+t.data.id+'/versions','POST',{files:starter.data.files});assert.equal(initial.status,200);
  const contestData={title:'P6.2 CAS fixture',author:'',stage:'initial',dateHeader:'',dateCover:'',language:'zh-CN',templates:{STATEMENT:null,EDITORIAL_DOCUMENT:null,EDITORIAL_BEAMER:null},items:[]};
  const c=await call('/contests','POST',{expectedVersion:0,data:contestData});assert.equal(c.status,200);
  let templateConflicts=0,contestConflicts=0;
  await Promise.all(Array.from({length:6},async(_,i)=>{
    for(let attempt=0;attempt<12;attempt++){
      const base=await db.templateVersion.findUniqueOrThrow({where:{id:initial.data.id}}),files={...starter.data.files,'preview.tex':starter.data.files['preview.tex']+'\n% writer '+i};
      const response=await call('/admin/template-versions/'+base.id,'PUT',{expectedVersion:base.editVersion,files});
      if(response.status===409){assert.equal(response.data.code,'VERSION_CONFLICT');templateConflicts++;continue;}
      assert.equal(response.status,200);assert.equal(response.data.editVersion,base.editVersion+1);assert.deepEqual(response.data.files,files);return;
    }throw new Error('template writer exhausted bounded retry');
  }));
  await Promise.all(Array.from({length:6},async(_,i)=>{
    for(let attempt=0;attempt<12;attempt++){
      const base=await db.contest.findUniqueOrThrow({where:{id:c.data.id}}),data={...contestData,stage:'writer '+i};
      const response=await call('/contests/'+base.id,'PUT',{expectedVersion:base.version,data});
      if(response.status===409){assert.equal(response.data.code,'VERSION_CONFLICT');contestConflicts++;continue;}
      assert.equal(response.status,200);assert.equal(response.data.version,base.version+1);assert.deepEqual(response.data.data,data);return;
    }throw new Error('contest writer exhausted bounded retry');
  }));
  assert(templateConflicts>0&&contestConflicts>0);
  assert.equal((await db.templateVersion.findUniqueOrThrow({where:{id:initial.data.id}})).editVersion,7);
  assert.equal((await db.contest.findUniqueOrThrow({where:{id:c.data.id}})).version,7);
  assert.equal(await db.build.count(),0);assert.equal(await db.testRun.count(),0);
  await mkdir('.local',{recursive:true});await writeFile('.local/verify-p6-editing.json',JSON.stringify({database,checkedAt:new Date(),templateConflicts,contestConflicts,checks:['delayed save retains later document/program edits and accepts server version/normalization','template generated files merge without restoring locally deleted files','contest array reorder retained','snapshot isolation and key-order-independent dirty signature','six concurrent template writers and six contest writers each receive their own committed version/content; stale writes rejected'],realJudgeOrTex:false},null,2));
  console.log('PASS P6.2 editing reconciliation and concurrent CAS responses; '+database);
}finally{await app.close();await db.$disconnect();}
