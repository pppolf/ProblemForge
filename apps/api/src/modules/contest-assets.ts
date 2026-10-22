import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { AssetInput, type StoredBlob } from '@problemforge/contracts';
import { db, type Prisma } from '@problemforge/database';
import { contestAccess, HttpError, sha256 } from '@problemforge/domain';
import { validateBody } from '@problemforge/template-engine';
import { authenticate, storage, type Api } from '../app.ts';
import { assetPath, readAssetImage } from './asset-image.ts';

export type FrozenContestAsset = { path: string; blob: StoredBlob };
export async function introductionAssets(tx: Prisma.TransactionClient, contestId: string | undefined, body: string): Promise<FrozenContestAsset[]> {
  const assets = contestId && body.trim() ? await tx.contestAsset.findMany({ where: { contestId }, orderBy: { id: 'asc' } }) : [];
  const used = new Set(validateBody(body, 'EDITORIAL_BEAMER', assets.map(assetPath)));
  return assets.filter(a => used.has(assetPath(a))).map(a => ({ path: assetPath(a), blob: { key: a.key, hash: a.hash, bytes: a.bytes } }));
}

const Id = Type.Object({ id: Type.String() });
const view = (a: { id: string; name: string; bytes: number; hash: string; mediaType: string }) => ({ id: a.id, name: a.name, bytes: a.bytes, hash: a.hash, mediaType: a.mediaType, path: assetPath(a) });
export async function contestAssetRoutes(app: Api) {
  app.get('/api/contests/:id/assets', { preHandler: authenticate, schema: { params: Id } }, async req => {
    await contestAccess(req.user, req.params.id);
    return (await db.contestAsset.findMany({ where: { contestId: req.params.id }, orderBy: { createdAt: 'desc' } })).map(view);
  });
  app.post('/api/contests/:id/assets', { preHandler: authenticate, schema: { params: Id, body: AssetInput } }, async req => {
    await contestAccess(req.user, req.params.id, true);
    const { bytes, mediaType } = readAssetImage(req.body.base64);
    const hash = sha256(bytes), key = `contest-assets/${req.params.id}/${randomUUID()}`;
    const checkQuota = async (client: Prisma.TransactionClient) => {
      const total = await client.contestAsset.aggregate({ where: { contestId: req.params.id }, _sum: { bytes: true }, _count: true });
      if (total._count >= 100 || (total._sum.bytes ?? 0) + bytes.length > 20_000_000) throw new HttpError(422, '本比赛图片资源额度已用完（最多 100 张、共 20MB）');
    };
    await checkQuota(db);
    // ManagedStorage commits its own quota reservation. Do this before holding a
    // database transaction/connection, otherwise parallel uploads can starve the
    // pool. A failed finalization leaves a registered, accounted, unreferenced
    // object for the existing conservative storage inspection to identify.
    await storage.put(key, bytes);
    const asset = await db.$transaction(async tx => {
      // Serialize uploads with each other and with contest freezing. Uploading an
      // unused immutable asset does not change the saved arrangement/version.
      await tx.$queryRaw`SELECT id FROM "Contest" WHERE id=${req.params.id} FOR UPDATE`;
      const contest = await tx.contest.findUniqueOrThrow({ where: { id: req.params.id } });
      if (contest.archived) throw new HttpError(409, '比赛已归档');
      await checkQuota(tx);
      const result = await tx.contestAsset.create({ data: { contestId: contest.id, name: req.body.name, key, hash, bytes: bytes.length, mediaType } });
      await tx.auditLog.create({ data: { actorId: req.user.id, action: 'UPLOAD_CONTEST_ASSET', resourceId: result.id, detail: { contestId: contest.id } } });
      return result;
    }, { timeout: 30000 });
    return view(asset);
  });
  app.get('/api/contests/:id/assets/:assetId/file', { preHandler: authenticate, schema: { params: Type.Object({ id: Type.String(), assetId: Type.String() }) } }, async (req, reply) => {
    await contestAccess(req.user, req.params.id);
    const asset = await db.contestAsset.findFirst({ where: { id: req.params.assetId, contestId: req.params.id } });
    if (!asset) throw new HttpError(404, '比赛图片不存在');
    const bytes = await storage.get(asset.key);
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.hash) throw new HttpError(409, '比赛图片校验失败');
    return reply.type(asset.mediaType).send(bytes);
  });
}
