import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config, hashPassword, sha256, token } from '@problemforge/domain';
import { db } from '@problemforge/database';

if (!process.argv.includes('--isolated')) {
  const url = new URL(process.env.DATABASE_URL!), database = `problemforge_p61_verify_${randomUUID().replaceAll('-','').slice(0,12)}`;
  await db.$executeRawUnsafe(`CREATE DATABASE "${database}"`); await db.$disconnect(); url.pathname = '/'+database;
  for (const args of [['scripts/database.ts','migrate'],[fileURLToPath(import.meta.url),'--isolated']]) {
    const r = spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',...args],{env:{...process.env,DATABASE_URL:url.toString()},stdio:'inherit'}); if(r.status!==0)process.exit(r.status??1);
  }
  process.exit(0);
}
const database = new URL(process.env.DATABASE_URL!).pathname; assert.match(database,/^\/problemforge_p61_verify_[a-f0-9]{12}$/);
const {createApp} = await import('../apps/api/src/app.ts'); const app = await createApp(false), address = await app.listen({host:'127.0.0.1',port:0});
const checks:string[]=[];
try {
  const passwordHash = await hashPassword(token());
  const owner = await db.user.create({data:{email:'owner@history.invalid',name:'History Owner',passwordHash}}), translator = await db.user.create({data:{email:'translator@history.invalid',name:'Translator',passwordHash}}), outsider = await db.user.create({data:{email:'outsider@history.invalid',name:'Outsider',passwordHash}});
  const raw = token(), csrf = token(); await db.session.create({data:{id:sha256(raw),userId:owner.id,csrfToken:csrf,expiresAt:new Date(Date.now()+3600000)}});
  const traw=token();await db.session.create({data:{id:sha256(traw),userId:translator.id,csrfToken:csrf,expiresAt:new Date(Date.now()+3600000)}});
  async function get(path:string,expected=200,cookie=raw) {const r=await app.inject({method:'GET',url:'/api'+path,headers:{cookie:'pf_session='+cookie}});assert.equal(r.statusCode,expected,`${path.split('?')[0]}: ${r.json().code ?? 'unexpected response'}`);return r.json();}
  const p=await db.problem.create({data:{title:'可检索历史',tags:['分组ABC'],responsibleId:owner.id,members:{create:[{userId:owner.id,role:'OWNER'},{userId:translator.id,role:'TRANSLATOR',languages:['zh-CN']}]}}});
  const hidden=await db.problem.create({data:{title:'私有隐藏题',members:{create:{userId:outsider.id,role:'OWNER'}}}});
  const zh=await db.document.create({data:{problemId:p.id,kind:'STATEMENT',language:'zh-CN'}}),en=await db.document.create({data:{problemId:p.id,kind:'STATEMENT',language:'en'}});
  const buildIds:string[]=[], runIds:string[]=[];
  for(let i=0;i<64;i++) {
    const createdAt = new Date(Date.parse('2026-09-01T00:00:00Z')+Math.floor(i/3)*1000), id=`history-b-${String(i).padStart(3,'0')}`,rid=`history-r-${String(i).padStart(3,'0')}`;
    await db.build.create({data:{id,requestedById:owner.id,problemId:p.id,documentId:i===1?en.id:zh.id,templateVersionId:'fixture-only',kind:'STATEMENT',purpose:'DOCUMENT',state:i%2?'FAILED':'CANCELED',input:{fixture:'pagination metadata only; no TeX execution'},inputHash:'fixture',log:'Pagination fixture; not executed',createdAt}});
    await db.testRun.create({data:{id:rid,requestedById:owner.id,problemId:p.id,requestKey:randomUUID(),purpose:i%2?'VALIDATE':'COMPILE',state:i%2?'FAILED':'CANCELED',input:{fixture:'pagination metadata only; no author code execution'},inputHash:'fixture',dependencyHash:'fixture',log:'Pagination fixture; not executed',createdAt}});
    buildIds.push(id);runIds.push(rid);
  }
  for(let i=0;i<60;i++) await db.build.create({data:{requestedById:owner.id,problemId:hidden.id,templateVersionId:'fixture-only',kind:'STATEMENT',state:'CANCELED',input:{fixture:true},inputHash:'fixture'}});
  for(let i=0;i<31;i++) await db.problem.create({data:{title:`分页题 ${i}`,archived:i===0,members:{create:{userId:owner.id,role:'OWNER'}}}});
  const first=await get('/builds/page?limit=7'); assert.equal(first.rows.length,7);assert(first.nextCursor);
  const late=await db.build.create({data:{requestedById:owner.id,problemId:p.id,documentId:zh.id,templateVersionId:'fixture-only',kind:'STATEMENT',state:'CANCELED',input:{fixture:true},inputHash:'fixture'}});
  const all=[...first.rows];let page=first;
  for(let n=0;page.nextCursor;n++){assert(n<30);page=await get('/builds/page?limit=7&cursor='+page.nextCursor);all.push(...page.rows);}
  assert.deepEqual(new Set(all.map(r=>r.id)),new Set(buildIds));assert.equal(all.length,64);assert(!all.some(r=>r.id===late.id));
  assert.equal((await get('/builds/'+buildIds[0])).log,'Pagination fixture; not executed');
  assert(!('input' in first.rows[0]));assert(!('log' in first.rows[0]));
  assert.equal((await get('/builds/page?limit=7&cursor='+first.currentCursor)).rows.map((r:any)=>r.id).join(),first.rows.map((r:any)=>r.id).join());
  checks.push('64 older-than-50 builds across equal timestamps; no duplicates/omissions; new insert excluded from snapshot; historical detail accessible; compact DTO');
  const runs:any[]=[];let cursor='';
  for(let n=0;n<30;n++){const r=await get('/test-runs/page?limit=9'+(cursor?'&cursor='+cursor:''));runs.push(...r.rows);cursor=r.nextCursor;if(!cursor)break;}
  assert.equal(runs.length,64);assert.deepEqual(new Set(runs.map(r=>r.id)),new Set(runIds));
  const filtered=await get('/test-runs/page?limit=100&state=FAILED&purpose=VALIDATE&problemId='+p.id+'&from=2026-09-01T00%3A00%3A05Z&to=2026-09-01T00%3A00%3A10Z');assert(filtered.rows.length>0);assert(filtered.rows.every((r:any)=>r.state==='FAILED'&&r.purpose==='VALIDATE'&&r.problemId===p.id&&r.createdAt>='2026-09-01T00:00:05.000Z'&&r.createdAt<='2026-09-01T00:00:10.000Z'));
  await get('/builds/page?cursor=not-json',400);await get('/builds/page?state=FAILED&cursor='+first.nextCursor,400);await get('/test-runs/page?cursor='+first.nextCursor,400);await get('/builds/page?cursor='+first.nextCursor,400,traw);
  await get('/builds/page?problemId='+hidden.id+'&cursor='+first.nextCursor,404);await get('/test-runs/page?problemId='+hidden.id,404);await get('/test-runs/page?problemId='+p.id,403,traw);
  const trans=await get('/builds/page?limit=100&problemId='+p.id,200,traw);assert.equal(trans.rows.length,64);assert(!trans.rows.some((r:any)=>r.id===buildIds[1]));
  await db.problemMember.delete({where:{problemId_userId:{problemId:p.id,userId:translator.id}}});await get('/builds/page?problemId='+p.id+'&cursor='+trans.currentCursor,404,traw);
  checks.push('Judge pagination and state/purpose/object/time filters; forged/cross-scope cursors rejected; translator language restriction and live membership revocation');
  const lists:any[]=[];cursor='';
  for(let n=0;n<20;n++){const r=await get('/problems/page?limit=8'+(cursor?'&cursor='+cursor:''));lists.push(...r.rows);cursor=r.nextCursor;if(!cursor)break;}
  assert.equal(lists.length,31);assert.equal(new Set(lists.map(p=>p.id)).size,31);assert(!lists.some(r=>r.id===hidden.id||r.archived));
  for(const q of ['可检索','abc','history owner']){const r=await get('/problems/page?q='+encodeURIComponent(q));assert.equal(r.rows.length,1);assert.equal(r.rows[0].id,p.id);}
  assert.equal((await get('/problems/page?archived=true&limit=100')).rows.length,32);
  checks.push('server-side name/tag-substring/responsible search, archive filter and permission-aware problem pagination');
  const controller=new AbortController(), events=await fetch(address+'/api/events?buildIds='+buildIds[0]+'&runIds='+runIds[0],{headers:{Cookie:'pf_session='+raw},signal:controller.signal});assert.equal(events.status,200);
  const reader=events.body!.getReader(),decoder=new TextDecoder();let stream='';const timeout=setTimeout(()=>controller.abort(),10000);
  try {
    while(!stream.includes('event: tasks')){const r=await reader.read();assert(!r.done);stream+=decoder.decode(r.value);}
    let data=JSON.parse(stream.match(/data: (\{[^\n]*\})/)![1]);assert(data.builds.some((r:any)=>r.id===buildIds[0]));assert(data.runs.some((r:any)=>r.id===runIds[0]));assert(!data.builds.some((r:any)=>!buildIds.includes(r.id)&&r.id!==late.id));
    await db.testRun.update({where:{id:runIds[0]},data:{stage:'分页订阅状态注入：未执行程序',completed:1}});
    stream='';while(!stream.includes('分页订阅状态注入')){const r=await reader.read();assert(!r.done);stream+=decoder.decode(r.value);}
  } finally {clearTimeout(timeout);controller.abort();}
  checks.push('SSE includes watched tasks older than newest 50 and delivers metadata change; no hidden object metadata');
  assert.equal(await db.build.count({where:{state:{in:['QUEUED','RUNNING']}}}),0);assert.equal(await db.testRun.count({where:{state:{in:['QUEUED','RUNNING']}}}),0);
  await mkdir('.local',{recursive:true});await writeFile('.local/verify-p6-history.json',JSON.stringify({database,checkedAt:new Date(),checks,fixtures:'metadata only; no real Judge/TeX execution'},null,2));
  console.log('PASS P6.1 history/search/SSE; isolated metadata fixtures retained: '+database);
} finally {await app.close();await db.$disconnect();}
