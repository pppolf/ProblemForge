import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, unlinkSync } from 'node:fs';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2),command=args.shift();
const option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const local=path=>{const target=resolve(root,path);if(!target.startsWith(root.endsWith(sep)?root:root+sep))throw new Error('运行配置和备份必须位于本项目目录');return target;};
const envPath=local(option('env')??'.local/production.env');
const exists=async path=>{try{await access(path);return true;}catch{return false;}};
if(command==='init'){
 if(await exists(envPath))throw new Error('配置已存在，不覆盖');
 const name=option('name')??'problemforge-prod',port=option('port')??'5181';
 if(!/^problemforge-[a-z0-9-]{2,40}$/.test(name)||!/^\d{4,5}$/.test(port)||Number(port)>65535)throw new Error('需要本项目专用名称和有效端口');
 const secret=()=>randomBytes(32).toString('hex');
 const config={COMPOSE_PROJECT_NAME:name,APP_ORIGIN:`http://localhost:${port}`,PF_HTTP_PORT:port,PF_APP_IMAGE:'problemforge-app:p5',POSTGRES_PASSWORD:secret(),REDIS_PASSWORD:secret(),TEX_SANDBOX_TOKEN:secret(),JUDGE_SANDBOX_TOKEN:secret(),ASSOCIATION_APP_KEY:'',API_TRUSTED_PROXIES:'',PF_ADMIN_EMAIL:'',PF_ADMIN_PASSWORD:'',STORAGE_QUOTA_BYTES:'10000000000'};
 await mkdir(dirname(envPath),{recursive:true});await writeFile(envPath,Object.entries(config).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{flag:'wx',mode:0o600});console.log('已创建忽略范围内的本地部署配置；凭据不输出。');process.exit(0);
}
const settings=Object.fromEntries((await readFile(envPath,'utf8')).split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
if(!/^problemforge-[a-z0-9-]{2,40}$/.test(settings.COMPOSE_PROJECT_NAME??''))throw new Error('拒绝操作非 ProblemForge 专用 project');
const base=['compose','--project-name',settings.COMPOSE_PROJECT_NAME,'--env-file',envPath,'-f',resolve(root,'infra/compose.prod.yml')];
if(['up','init-admin','backup','restore','storage-check'].includes(command)) {
 const locks=local('.local/ops-locks');await mkdir(locks,{recursive:true});const lock=resolve(locks,settings.COMPOSE_PROJECT_NAME+'.lock');
 try{await writeFile(lock,JSON.stringify({pid:process.pid,command,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});}catch(e){if(e.code==='EEXIST')throw new Error('该实例已有维护操作或残留锁；先核实进程/容器状态，不自动抢锁');throw e;}
 process.on('exit',()=>{try{unlinkSync(lock);}catch{}});
}
const imageId=()=>{const r=spawnSync('docker',['image','inspect',settings.PF_APP_IMAGE,'--format','{{.Id}}'],{encoding:'utf8'});if(r.status!==0)throw new Error('部署镜像不可用');return r.stdout.trim();};
function run(tail,{input,output,capture=false}={}){return new Promise((resolvePromise,reject)=>{
 const child=spawn('docker',[...base,...tail],{cwd:root,env:{...process.env,...settings},stdio:[input?'pipe':'ignore',output||capture?'pipe':'inherit','inherit']});
 let text='';let stream;
 if(input){child.stdin.on('error',reject);createReadStream(input).on('error',reject).pipe(child.stdin);}
 if(output){stream=createWriteStream(output,{flags:'wx',mode:0o600});stream.on('error',reject);child.stdout.pipe(stream);}
 else if(capture)child.stdout.on('data',chunk=>{text+=chunk;if(text.length>16_000_000){child.kill();reject(new Error('命令输出超过限制'));}});
 child.on('error',reject);child.on('close',async code=>{if(stream&&!stream.writableFinished)await new Promise(r=>stream.once('finish',r));if(code)reject(new Error(`Compose ${tail[0]} 失败 (${code})`));else resolvePromise(text.trim());});
});}
const digest=async path=>{const hash=createHash('sha256');for await(const b of createReadStream(path))hash.update(b);return hash.digest('hex');};
const tool=(script,extra=[],options={})=>run(['run','--rm','-T','--no-deps','toolbox','node','--import','tsx',script,...extra],options);
if(command==='up'){await run(['up','-d','--no-build','--wait','--wait-timeout','180']);}
else if(command==='init-admin'){await run(['run','--rm','-T','--no-deps','-e','PF_ADMIN_EMAIL','-e','PF_ADMIN_PASSWORD','toolbox','node','--import','tsx','scripts/init-admin.ts']);}
else if(command==='state'){await tool('scripts/ops-state.ts');}
else if(command==='storage-check'){
 const out=local(option('out')??`.local/maintenance/storage-${Date.now()}.json`);if(await exists(out))throw new Error('报告已存在，不覆盖');await mkdir(dirname(out),{recursive:true});
 try{await run(['stop','api','tex-worker','judge-worker']);await tool('scripts/storage-inspect.ts',['--offline'],{output:out});console.log(`只读盘点完成：${out}`);}finally{await run(['up','-d','--no-build','api','tex-worker','judge-worker']);}
}
else if(command==='backup'){
 const out=local(option('out')??`.local/backups/${Date.now()}`);if(await exists(out))throw new Error('备份目录已存在，不覆盖');await mkdir(out,{recursive:true});
 try{
  await run(['stop','api','tex-worker','judge-worker']);
  const state=JSON.parse(await tool('scripts/ops-state.ts',['--quiescent'],{capture:true}));
  await writeFile(resolve(out,'state.json'),JSON.stringify(state,null,2));
  await run(['exec','-T','postgres','pg_dump','-U','problemforge','-d','problemforge','--format=custom','--no-owner'],{output:resolve(out,'database.dump')});
  await run(['run','--rm','-T','--no-deps','toolbox','tar','-cpf','-','-C','/data','.'],{output:resolve(out,'storage.tar')});
  const files={};for(const name of ['database.dump','storage.tar','state.json'])files[name]=await digest(resolve(out,name));
  const runningImage=(await run(['images','-q','api'],{capture:true})).split('\n')[0];
  const appImageId=imageId();if(!runningImage||!appImageId.replace(/^sha256:/,'').startsWith(runningImage.replace(/^sha256:/,'')))throw new Error('运行镜像与配置标签不一致，备份不标记完成');
  await writeFile(resolve(out,'manifest.json'),JSON.stringify({version:1,project:settings.COMPOSE_PROJECT_NAME,appImage:settings.PF_APP_IMAGE,appImageId,createdAt:new Date().toISOString(),files},null,2));console.log(`备份完成：${out}`);
 }finally{await run(['up','-d','--no-build','api','tex-worker','judge-worker']);}
}
else if(command==='restore'){
 if(!option('from'))throw new Error('restore 需要 --from 备份目录');const source=local(option('from')),manifest=JSON.parse(await readFile(resolve(source,'manifest.json'),'utf8'));
 if(manifest.version!==1||manifest.project===settings.COMPOSE_PROJECT_NAME)throw new Error('仅恢复到不同名称的空实例；不覆盖来源');
 if(manifest.appImageId!==imageId())throw new Error('恢复需使用备份时的相同镜像 ID；恢复验收后再升级');
 for(const name of ['database.dump','storage.tar','state.json'])if(await digest(resolve(source,name))!==manifest.files[name])throw new Error(`备份校验失败：${name}`);
 const existing=await run(['ps','-a','-q','api','tex-worker','judge-worker'],{capture:true});if(existing)throw new Error('目标已运行过应用，拒绝恢复；请使用新的 project 和卷');
 await run(['up','-d','--no-build','--wait','postgres','redis']);
 await run(['run','--rm','-T','--no-deps','storage-init']);
 const tables=await run(['exec','-T','postgres','psql','-U','problemforge','-d','problemforge','-Atc',"SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"],{capture:true});if(tables!=='0')throw new Error('目标数据库非空，不覆盖');
 await run(['run','--rm','-T','--no-deps','toolbox','node','-e',"require('fs').readdir('/data',(e,x)=>process.exit(e||x.length?1:0))"]);
 const names=await run(['run','--rm','-T','--no-deps','toolbox','tar','-tf','-'],{input:resolve(source,'storage.tar'),capture:true});
 if(names.split('\n').some(p=>!/^\.\/(?:[A-Za-z0-9_./-]*)?$/.test(p)||p.split('/').includes('..')))throw new Error('备份成员路径不安全');
 const kinds=await run(['run','--rm','-T','--no-deps','toolbox','tar','-tvf','-'],{input:resolve(source,'storage.tar'),capture:true});if(kinds.split('\n').some(l=>!['-','d'].includes(l[0])))throw new Error('备份包含链接或特殊文件');
 await run(['exec','-T','postgres','pg_restore','-U','problemforge','-d','problemforge','--no-owner','--exit-on-error'],{input:resolve(source,'database.dump')});
 await run(['run','--rm','-T','--no-deps','toolbox','tar','-xpf','-','--no-same-owner','-C','/data'],{input:resolve(source,'storage.tar')});
 const restored=JSON.parse(await tool('scripts/ops-state.ts',['--quiescent'],{capture:true})),expected=JSON.parse(await readFile(resolve(source,'state.json'),'utf8'));
 if(JSON.stringify(restored)!==JSON.stringify(expected))throw new Error('恢复后清单或文件哈希不一致，应用未启动');
 await run(['up','-d','--no-build','--wait','--wait-timeout','180']);console.log('空实例恢复完成，数据库计数、迁移与全部已登记私有文件逐项验证一致。');
}
else throw new Error('命令：init / up / init-admin / state / backup / restore / storage-check；详见 docs/DEPLOYMENT.md');
