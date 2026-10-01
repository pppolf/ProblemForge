import { hostname } from 'node:os';
import { db } from '@problemforge/database';
import { config, judgeQueue, texQueue } from '@problemforge/domain';
import { SandboxClient } from '../packages/judge-adapter/src/index.ts';
const kind=process.argv[2];if(!['judge','tex'].includes(kind))throw new Error('需要 judge 或 tex');
const queue=kind==='tex'?texQueue():judgeQueue();queue.on('error',()=>{});
try{
  const worker=await db.workerHeartbeat.findFirst({where:{kind,id:{startsWith:`${kind}-${hostname()}-`},heartbeatAt:{gt:new Date(Date.now()-config.leaseMs)}}});
  if(!worker)throw new Error('Worker heartbeat missing');
  await(await queue.client).ping();
  await new SandboxClient(kind==='tex'?config.sandboxUrl:config.judgeSandboxUrl,kind==='tex'?config.sandboxToken:config.judgeSandboxToken!).health();
}catch{process.exitCode=1;}finally{await queue.close();await db.$disconnect();}
