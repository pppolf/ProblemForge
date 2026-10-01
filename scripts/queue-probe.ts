import assert from 'node:assert/strict';
import { db } from '@problemforge/database';
import { judgeQueue } from '@problemforge/domain';
// Explicit recovery drill, called only after stopping the dedicated deployment worker.
const [operation,id]=process.argv.slice(2),run=await db.testRun.findUniqueOrThrow({where:{id}});
assert.equal(run.state,'QUEUED');assert(run.queuedAt,'必须验证已投递、随后丢失的记录');
const queue=judgeQueue(),job=await queue.getJob(id);
if(operation==='remove'){assert(job);await job.remove();assert.equal(await queue.getJob(id),undefined);console.log('REMOVED');}
else if(operation==='exists'){assert(job);console.log('RECOVERED');}
else throw new Error('operation must be remove or exists');
await queue.close();await db.$disconnect();
