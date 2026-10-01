import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '@problemforge/database';
import { config, sha256 } from '@problemforge/domain';
if (!process.argv.includes('--offline')) throw new Error('必须停止写入服务后用 --offline 执行存储盘点');
const objects:{key:string;hash:string;bytes:number}[]=[];
async function walk(dir:string,prefix=''){
  for(const e of await readdir(dir,{withFileTypes:true})){
    if(e.isSymbolicLink())throw new Error('私有存储中禁止链接');
    const key=prefix+e.name,path=join(dir,e.name);
    if(e.isDirectory())await walk(path,key+'/');
    else if(e.isFile()){const b=await readFile(path);objects.push({key,hash:sha256(b),bytes:b.length});}
    else throw new Error('私有存储中存在特殊文件');
  }
}
await walk(config.storageRoot);
const total=objects.reduce((n,o)=>n+o.bytes,0);
if(total>config.storageQuotaBytes)throw new Error('已有数据超过配额，请先调整 STORAGE_QUOTA_BYTES，不能忽略现有字节');
await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(70405101)::text`;
  for(const o of objects){
    const previous=await tx.storedObject.findUnique({where:{key:o.key}});
    if(previous&&(previous.hash!==o.hash||previous.bytes!==BigInt(o.bytes)))throw new Error(`已有不可变文件与登记内容不符：${o.key}`);
    await tx.storedObject.upsert({where:{key:o.key},create:{...o,ready:true},update:{ready:true}});
  }
  const reserved=(await tx.storedObject.aggregate({_sum:{bytes:true}}))._sum.bytes??0n;
  if(reserved>BigInt(config.storageQuotaBytes))throw new Error('文件及保留预留合计超过配额，请先扩容');
  // Missing reservations remain counted: a recovery never silently discards capacity/evidence.
},{timeout:120000});
console.log(JSON.stringify({objects:objects.length,bytes:total,quota:config.storageQuotaBytes}));await db.$disconnect();
