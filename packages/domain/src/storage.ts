import { db } from '@problemforge/database';
import { PrivateFileStorage } from '@problemforge/storage';
import { config, sha256, HttpError } from './index.ts';

// Commit reservations before writing. A crash may leave counted unused capacity,
// but can never silently exceed the cap. Accounting repair runs only while stopped.
export class ManagedStorage extends PrivateFileStorage {
  async put(key: string, bytes: Buffer) {
    const hash = sha256(bytes);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(70405101)::text`;
      const old = await tx.storedObject.findUnique({ where: { key } });
      if (old) {
        if (old.hash !== hash || old.bytes !== BigInt(bytes.length)) throw new Error('不可变存储键内容冲突');
        return;
      }
      const used = (await tx.storedObject.aggregate({ _sum: { bytes: true } }))._sum.bytes ?? 0n;
      if (used + BigInt(bytes.length) > BigInt(config.storageQuotaBytes)) throw new HttpError(507, '私有存储配额已满；请管理员扩容或按保留策略清理', 'STORAGE_QUOTA');
      await tx.storedObject.create({ data: { key, hash, bytes: bytes.length } });
    });
    await super.put(key, bytes);
    await db.storedObject.update({ where: { key }, data: { ready: true } });
  }
}
