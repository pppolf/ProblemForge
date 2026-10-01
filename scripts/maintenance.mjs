import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, realpath, readdir, unlink, rmdir, lstat } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { backupFiles, readKey, encryptBackup, decryptBackup, retentionPreview } from './backup-crypto.mjs';
const root=await realpath(fileURLToPath(new URL('../',import.meta.url))),args=process.argv.slice(2),command=args.shift();
const option=n=>{const i=args.indexOf('--'+n);return i<0?undefined:args[i+1];};
const within=p=>{const rel=relative(root,p);return !!rel&&!rel.startsWith('..')&&!rel.includes(':');};
async function local(value) {
  if(!value)throw new Error('缺少路径参数');const path=resolve(root,value);if(!within(path))throw new Error('维护文件必须位于本项目内');
  let parent=path;while(true){try{if(!within(await realpath(parent))&&await realpath(parent)!==root)throw new Error('路径经链接指向项目外');break;}catch(e){if(e.code!=='ENOENT')throw e;parent=dirname(parent);}}
  return path;
}
async function cleanTemp(path) {
  if(!within(path)||!/^temporary-[a-f0-9-]+$/.test(path.split(/[\\/]/).at(-1)))throw new Error('拒绝清理非本次临时目录');
  try {if(await realpath(path)!==path)throw new Error('临时目录不允许链接');}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const name of backupFiles){const file=join(path,name);try {const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink())throw new Error('临时成员不是普通文件');await unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
  await rmdir(path); // No recursive deletion: unexpected members are preserved and reported.
}
function ops(tail){return new Promise((ok,fail)=>{const p=spawn(process.execPath,[resolve(root,'scripts/ops.mjs'),...tail],{cwd:root,stdio:'inherit'});p.on('error',fail);p.on('close',code=>code?fail(new Error(`备份/恢复步骤失败 (${code})，请检查终端与结果记录`)):ok());});}
if(command==='keygen') {const out=await local(option('out'));await mkdir(dirname(out),{recursive:true});await writeFile(out,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});console.log('随机密钥已写入指定私有文件，不输出密钥；请离线另存并限制文件权限。');process.exit(0);}
const runId=randomUUID(),resultDir=await local('.local/maintenance-results');await mkdir(resultDir,{recursive:true,mode:0o700});const resultPath=join(resultDir,runId+'.json');
const result={runId,command,startedAt:new Date().toISOString(),status:'RUNNING'};
const save=()=>writeFile(resultPath,JSON.stringify(result,null,2),{mode:0o600});await save();
let temp;
try {
  if(command==='backup'||command==='retention') {
    const configPath=await local(option('config')),config=JSON.parse(await readFile(configPath,'utf8'));
    const destination=await local(config.destination);await mkdir(destination,{recursive:true,mode:0o700});
    retentionPreview([],config); // Validate policy before stopping services.
    if(command==='retention') {
      const entries=[],incomplete=[];
      for(const entry of await readdir(destination,{withFileTypes:true})) {
        if(entry.isSymbolicLink())throw new Error('备份目录包含链接');if(!entry.isDirectory())continue;
        try {const marker=join(destination,entry.name,'encryption.json');if(!(await lstat(marker)).isFile()||(await lstat(marker)).isSymbolicLink())throw new Error('invalid');const m=JSON.parse(await readFile(marker,'utf8'));if(m.format!=='problemforge-encrypted-backup/v1'||!Number.isFinite(Date.parse(m.createdAt))||JSON.stringify(m.files)!==JSON.stringify(backupFiles))throw new Error('invalid');for(const name of backupFiles){const s=await lstat(join(destination,entry.name,name+'.enc'));if(!s.isFile()||s.isSymbolicLink()||s.size<=36)throw new Error('incomplete');}entries.push({directory:entry.name,createdAt:m.createdAt,keyId:m.keyId});}catch{incomplete.push(entry.name);}
      }
      result.preview={canDelete:false,entries:retentionPreview(entries,config),incomplete};console.log(JSON.stringify(result.preview));
    }else {
      const env=await local(config.env),key=await readKey(await local(config.keyFile));
      const id='backup-'+new Date().toISOString().replace(/[^0-9]/g,'')+'-'+runId.slice(0,8),out=join(destination,id);
      temp=await local('.local/maintenance-temp/temporary-'+runId);await mkdir(dirname(temp),{recursive:true,mode:0o700});
      await ops(['backup','--env',env,'--out',temp]);
      await mkdir(out,{mode:0o700});await encryptBackup(temp,out,key,id);result.backup=relative(root,out);result.keyId=(JSON.parse(await readFile(join(out,'encryption.json'),'utf8'))).keyId;
      console.log(`加密备份完成：${out}`);
    }
  }else if(command==='restore') {
    const source=await local(option('from')),env=await local(option('env')),key=await readKey(await local(option('key-file')));
    temp=await local('.local/maintenance-temp/temporary-'+runId);await mkdir(temp,{recursive:true,mode:0o700});
    // Authenticate every file before ops may create or write any target database/volume.
    await decryptBackup(source,temp,key);await ops(['restore','--env',env,'--from',temp]);result.source=relative(root,source);
  }else throw new Error('命令：keygen --out；backup/retention --config；restore --env --from --key-file');
  result.status='SUCCEEDED';
}catch(e){result.status='FAILED';result.error=e.message;console.error(`维护失败：${e.message}`);process.exitCode=1;}
finally {if(temp)try{await cleanTemp(temp);}catch(e){result.status='FAILED';result.cleanupError=e.message;process.exitCode=1;console.error('私有临时目录未完全清理，请检查结果记录。');}result.finishedAt=new Date().toISOString();await save();console.log(`维护结果：${resultPath}（${result.status}）`);}
