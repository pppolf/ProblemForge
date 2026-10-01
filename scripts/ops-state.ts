import { db } from '@problemforge/database';
import { config, ManagedStorage, sha256, hashObject } from '@problemforge/domain';
import { readFile } from 'node:fs/promises';
const storage=new ManagedStorage(config.storageRoot);
const running=await db.build.count({where:{state:'RUNNING'}})+await db.testRun.count({where:{state:'RUNNING'}});
if(process.argv.includes('--quiescent')&&running)throw new Error('仍有 RUNNING 记录；先恢复任务到终态再备份');
const objects=await db.storedObject.findMany({where:{ready:true},orderBy:{key:'asc'}});
for(const o of objects){const bytes=await storage.get(o.key);if(sha256(bytes)!==o.hash||BigInt(bytes.length)!==o.bytes)throw new Error(`私有文件校验失败：${o.key}`);}
const migrations=await db.$queryRaw<{migration_name:string;checksum:string}[]>`SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
for(const m of migrations)if(sha256(await readFile(`packages/database/prisma/migrations/${m.migration_name}/migration.sql`))!==m.checksum)throw new Error(`迁移字节不匹配：${m.migration_name}`);
console.log(JSON.stringify({migrations,counts:{users:await db.user.count(),problems:await db.problem.count(),contests:await db.contest.count(),builds:await db.build.count(),testRuns:await db.testRun.count(),artifacts:await db.artifact.count()},storage:{objects:objects.length,bytes:objects.reduce((n,o)=>n+Number(o.bytes),0),inventoryHash:hashObject(objects.map(o=>({key:o.key,hash:o.hash,bytes:Number(o.bytes)})))},running}));await db.$disconnect();
