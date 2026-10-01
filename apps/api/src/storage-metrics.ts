import { db } from '@problemforge/database';
import { config } from '@problemforge/domain';
export function capacityStatus(bytes:number,limit:number,warningPercent:number) {
  const percent=bytes/limit*100;
  return {percent,warningPercent,status:bytes>=limit?'full':percent>=warningPercent?'warning':'ok'};
}
export async function storageMetrics() {
  const [all,pending,oldest,cache,growth]=await Promise.all([
    db.storedObject.aggregate({_sum:{bytes:true},_count:true}),
    db.storedObject.aggregate({where:{ready:false},_sum:{bytes:true},_count:true}),
    db.storedObject.findFirst({where:{ready:false},orderBy:{createdAt:'asc'},select:{createdAt:true}}),
    db.$queryRaw<{bytes:bigint;objects:bigint}[]>`SELECT COALESCE(sum(o.bytes),0)::bigint AS bytes, count(*)::bigint AS objects FROM "StoredObject" o WHERE EXISTS (SELECT 1 FROM "CompileCache" c WHERE c.key=o.key)`,
    db.$queryRaw<{day:string;bytes:bigint;objects:bigint}[]>`SELECT to_char("createdAt",'YYYY-MM-DD') AS day, sum(bytes)::bigint AS bytes, count(*)::bigint AS objects FROM "StoredObject" WHERE "createdAt">=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')-INTERVAL '30 days' GROUP BY 1 ORDER BY 1`,
  ]);
  const bytes=Number(all._sum.bytes??0n);
  return {bytes,limit:config.storageQuotaBytes,objects:all._count,pending:pending._count,pendingBytes:Number(pending._sum.bytes??0n),oldestPendingAt:oldest?.createdAt??null,cache:{bytes:Number(cache[0].bytes),objects:Number(cache[0].objects)},growth:growth.map(r=>({...r,bytes:Number(r.bytes),objects:Number(r.objects)})),...capacityStatus(bytes,config.storageQuotaBytes,config.storageWarningPercent)};
}
