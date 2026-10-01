import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
function git(...args){const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(r.status)throw new Error('Git 信息读取失败');return r.stdout.trim();}
if(git('status','--porcelain'))throw new Error('版本镜像要求先检查并提交工作区，拒绝将未提交代码标记为已提交版本');
const commit=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}'),builtAt=new Date().toISOString();
const buildId=process.argv[2]??`${builtAt.replace(/[^0-9]/g,'').slice(0,14)}-${commit.slice(0,12)}`;
if(!/^[a-z0-9][a-z0-9_.-]{2,80}$/.test(buildId))throw new Error('构建标识只能含小写字母、数字、点、下划线和连字符');
const tag=`problemforge-app:${buildId}`,out=resolve(root,'.local/releases',buildId+'.json');
try{await access(out);throw new Error('构建标识已存在，不覆盖');}catch(e){if(e.code!=='ENOENT')throw e;}
const existing=spawnSync('docker',['image','inspect',tag],{stdio:'ignore'});if(existing.status===0)throw new Error('镜像标签已存在，不覆盖');
await new Promise((ok,fail)=>{
  // Archive only committed files: local credentials and a mutable checkout never enter the context.
  const archive=spawn('git',['archive','--format=tar',commit],{cwd:root,stdio:['ignore','pipe','inherit']});
  const docker=spawn('docker',['build','-f','infra/app.Dockerfile','--build-arg',`PF_GIT_COMMIT=${commit}`,'--build-arg',`PF_GIT_TREE=${tree}`,'--build-arg',`PF_BUILD_ID=${buildId}`,'--build-arg',`PF_BUILD_AT=${builtAt}`,'-t',tag,'-'],{cwd:root,stdio:['pipe','inherit','inherit']});
  archive.stdout.pipe(docker.stdin);let archiveCode=null;
  archive.on('error',fail);docker.on('error',fail);docker.stdin.on('error',fail);
  archive.on('close',code=>{archiveCode=code;if(code){docker.kill();fail(new Error('Git archive 失败'));}});
  docker.on('close',code=>code||archiveCode!==0?fail(new Error(`镜像构建失败 (${code})`)):ok());
});
const inspect=spawnSync('docker',['image','inspect',tag,'--format','{{.Id}}'],{encoding:'utf8'});if(inspect.status)throw new Error('不能读取已构建镜像');
await mkdir(resolve(root,'.local/releases'),{recursive:true});
await writeFile(out,JSON.stringify({buildId,gitCommit:commit,gitTree:tree,builtAt,tag,imageId:inspect.stdout.trim()},null,2),{flag:'wx'});
console.log(`版本镜像完成：${tag}；清单 ${out}`);
