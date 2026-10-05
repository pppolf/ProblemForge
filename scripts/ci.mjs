import { spawnSync } from 'node:child_process';
import { readFile, readdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const args=process.argv.slice(2),index=args.indexOf('--base'),base=index>=0?args[index+1]:process.env.PF_DIFF_BASE;
const supplied=args.indexOf('--files'),plan=args.includes('--plan');
function git(argv){const r=spawnSync('git',argv,{encoding:'utf8'});if(r.status!==0)throw new Error('不能确定变更范围；请显式指定有效 --base 或 --files，不回退全仓');return r.stdout.trim().split(/\r?\n/).filter(Boolean);}
// GitHub marks a newly pushed branch with an all-zero before SHA. Its initial
// scope is the committed tree; other missing/invalid bases still fail closed.
const initialPush=process.env.GITHUB_EVENT_NAME==='push'&&/^0{40}$/.test(base??'');
const files=supplied>=0?args.slice(supplied+1).filter(v=>v!=='--plan'):(initialPush?git(['ls-tree','-r','--name-only','HEAD']):(base?git(['diff','--name-only',base,'--']):(()=>{throw new Error('没有差异基准；使用 --base <commit> 或 --files <paths>');})()));
const packages=[];
for(const group of ['apps','packages','workers'])for(const name of await readdir(group)){try{const dir=`${group}/${name}`,p=JSON.parse(await readFile(`${dir}/package.json`,'utf8'));packages.push({dir,name:p.name,scope:p.name.replace('@problemforge/',''),deps:Object.keys({...p.dependencies,...p.devDependencies})});}catch{}}
const affected=new Set();
if(files.some(f=>['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json'].includes(f)))packages.forEach(p=>affected.add(p.name));
for(const p of packages)if(files.some(f=>f.startsWith(p.dir+'/')))affected.add(p.name);
if(files.some(f=>f.startsWith('vendor/testlib/')))affected.add('@problemforge/judge-core');
if(files.some(f=>f.startsWith('templates/')))affected.add('@problemforge/template-engine');
for(let changed=true;changed;){changed=false;for(const p of packages)if(!affected.has(p.name)&&p.deps.some(d=>affected.has(d))){affected.add(p.name);changed=true;}}
const order=['contracts','database','storage','domain','template-engine','judge-adapter','judge-core','problem-format','api','web','tex-worker','judge-worker'];
const scopes=order.filter(s=>affected.has('@problemforge/'+s)),suites=[];
if(affected.has('@problemforge/template-engine'))suites.push('template','contest');
if(affected.has('@problemforge/storage'))suites.push('storage');
if(affected.has('@problemforge/judge-core'))suites.push('judge','p3');
if(files.some(f=>f==='scripts/quick.mjs')&&!suites.length)suites.push('quick');
console.log(JSON.stringify({files:files.length,typecheck:scopes,quick:suites,realIntegration:false,productionBuild:false}));
function run(bin,argv){const r=spawnSync(bin,argv,{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
if(!plan){
 for(const f of files.filter(f=>f.endsWith('.mjs'))){try{await access(f);}catch{continue;}run(process.execPath,['--check',resolve(f)]);}
 if(scopes.length)run(process.execPath,['scripts/check.mjs',...scopes]);
 for(const suite of suites)run(process.execPath,['scripts/quick.mjs',suite]);
 if(!scopes.length&&!suites.length)console.log('本次范围没有选中类型或快速测试；未报告为测试通过。');
}
