import { readdir, lstat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, join } from 'node:path';
import { db, Prisma } from '@problemforge/database';
import { config } from '@problemforge/domain';

const keyShape=(s:string)=>/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(s)&&s.includes('/')&&!s.split('/').some(p=>!p||p==='..'||p==='.');
export function collectReferences(value:unknown,known:Set<string>,refs:Map<string,Set<string>>,source:string,field='') {
  if(typeof value==='string') {
    if(known.has(value)||((field==='key'||field.endsWith('Key'))&&keyShape(value))) {const reasons=refs.get(value)??new Set<string>();reasons.add(source);refs.set(value,reasons);}
  } else if(Array.isArray(value)) for(const v of value)collectReferences(v,known,refs,source,field);
  else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value))collectReferences(v,known,refs,source,k);
}
export function cleanupDecision(o:{ready:boolean;createdAt:Date},referenced:boolean,intact:boolean,now:Date,graceDays:number) {
  return o.ready&&!referenced&&intact&&o.createdAt.getTime()<now.getTime()-graceDays*86400000;
}
export async function inspectStorage(graceDays=7) {
  const root=await realpath(config.storageRoot),disk=new Map<string,{bytes:number;hash:string}>();
  async function walk(dir:string,prefix='') {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
      const path=join(dir,entry.name),key=prefix+entry.name,stat=await lstat(path);
      if(stat.isSymbolicLink())throw new Error('拒绝包含链接的存储目录');
      const actual=await realpath(path),rel=relative(root,actual);if(rel.startsWith('..')||resolve(root,rel)!==actual)throw new Error('存储路径越界');
      if(stat.isDirectory())await walk(path,key+'/');
      else if(stat.isFile()){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);disk.set(key,{bytes:stat.size,hash:hash.digest('hex')});}
      else throw new Error('存储中存在特殊文件');
    }
  }
  await walk(root);
  const objects=await db.storedObject.findMany({orderBy:{key:'asc'}}),registered=new Map(objects.map(o=>[o.key,o])),known=new Set([...disk.keys(),...registered.keys()]),refs=new Map<string,Set<string>>();
  // Inspect every persisted JSON field plus explicit blob-key columns, including
  // immutable revisions, task snapshots/reports, revoked releases and cache rows.
  for(const model of Prisma.dmmf.datamodel.models) {
    if(model.name==='StoredObject')continue;
    const fields=model.fields.filter(f=>f.kind!=='object'&&(f.type==='Json'||f.name==='key'||f.name.endsWith('Key')));
    if(!fields.length)continue;
    const select=Object.fromEntries(fields.map(f=>[f.name,true])),orderBy=Object.fromEntries(model.fields.filter(f=>f.isId).map(f=>[f.name,'asc']));
    const delegate=(db as any)[model.name[0].toLowerCase()+model.name.slice(1)];
    for(let skip=0;;skip+=250){const rows=await delegate.findMany({select,take:250,skip,...(Object.keys(orderBy).length?{orderBy}: {})});for(const row of rows)collectReferences(row,known,refs,model.name);if(rows.length<250)break;}
  }
  const now=new Date(),issues:{key:string;kind:string}[]=[],retained:{key:string;reasons:string[]}[]=[],candidates:{key:string;bytes:number;reason:string}[]=[],pending:{key:string;bytes:number;fileExists:boolean}[]=[];
  for(const o of objects) {
    const file=disk.get(o.key),intact=!!file&&file.hash===o.hash&&BigInt(file.bytes)===o.bytes;
    if(o.ready&&!file)issues.push({key:o.key,kind:'READY_FILE_MISSING'});
    if(file&&!intact)issues.push({key:o.key,kind:'HASH_OR_SIZE_MISMATCH'});
    if(!o.ready)pending.push({key:o.key,bytes:Number(o.bytes),fileExists:!!file});
    if(refs.has(o.key))retained.push({key:o.key,reasons:[...refs.get(o.key)!].sort()});
    else if(cleanupDecision(o,false,intact,now,graceDays))candidates.push({key:o.key,bytes:Number(o.bytes),reason:'完整登记文件已超过宽限期，全部已检查引用中未发现；仍需人工复核'});
  }
  for(const [key]of disk)if(!registered.has(key))issues.push({key,kind:'UNREGISTERED_FILE'});
  for(const key of refs.keys()){if(!registered.has(key))issues.push({key,kind:'REFERENCE_NOT_REGISTERED'});if(!disk.has(key))issues.push({key,kind:'REFERENCED_FILE_MISSING'});}
  return {checkedAt:now.toISOString(),mode:'offline-read-only',graceDays,objects:objects.length,files:disk.size,diskBytes:[...disk.values()].reduce((n,f)=>n+f.bytes,0),issues,pending,retained,cleanupPreview:{canDelete:false,candidates,notice:'仅预览，不删除文件、缓存、登记行或预留。冻结修订、发布/撤回及所有历史任务引用均保留。'}};
}
