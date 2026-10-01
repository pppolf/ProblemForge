import { db } from '@problemforge/database';
import { inspectStorage } from './storage-inspection.ts';
if(!process.argv.includes('--offline'))throw new Error('盘点要求停止 API/Worker 后显式 --offline；请使用 ops storage-check');
try { if(await db.build.count({where:{state:'RUNNING'}})+await db.testRun.count({where:{state:'RUNNING'}}))throw new Error('仍有 RUNNING 任务，拒绝把未完成写入误判为孤立文件'); console.log(JSON.stringify(await inspectStorage())); }
finally { await db.$disconnect(); }
