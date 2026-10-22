import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import { AssetInput } from '@problemforge/contracts';
import { db } from '@problemforge/database';
import { HttpError, sha256, problemAccess, problemPermission, audit } from '@problemforge/domain';
import { authenticate, storage, type Api } from '../app.ts';
import { assetPath, readAssetImage } from './asset-image.ts';
export { assetPath } from './asset-image.ts';
export async function assetRoutes(app: Api) {
  app.get('/api/problems/:id/assets', { preHandler: authenticate, schema: { params: Type.Object({ id: Type.String() }) } }, async req => {
    await problemPermission(req.user,req.params.id);
    // Images are explicitly shared across this problem's language drafts.
    return (await db.asset.findMany({ where: { problemId: req.params.id }, orderBy: { createdAt: 'desc' } })).map(a => ({ id: a.id, name: a.name, bytes: a.bytes, hash: a.hash, mediaType: a.mediaType, path: assetPath(a) }));
  });
  app.post('/api/problems/:id/assets', { preHandler: authenticate, schema: { params: Type.Object({ id: Type.String() }), body: AssetInput } }, async req => {
    await problemAccess(req.user, req.params.id, true);
    const { bytes, mediaType } = readAssetImage(req.body.base64);
    const total = await db.asset.aggregate({ where: { problemId: req.params.id }, _sum: { bytes: true }, _count: true });
    if (total._count >= 100 || (total._sum.bytes ?? 0) + bytes.length > 20_000_000) throw new HttpError(422, '本题图片资源额度已用完');
    const hash = sha256(bytes), key = `assets/${req.params.id}/${randomUUID()}`;
    await storage.put(key, bytes);
    const asset = await db.asset.create({ data: { problemId: req.params.id, name: req.body.name, key, hash, bytes: bytes.length, mediaType } });
    await audit(req.user.id, 'UPLOAD_ASSET', asset.id);
    return { id: asset.id, name: asset.name, hash, bytes: bytes.length, path: assetPath(asset) };
  });
  app.get('/api/assets/:id/file', { preHandler: authenticate, schema: { params: Type.Object({ id: Type.String() }) } }, async (req, reply) => {
    const asset = await db.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) throw new HttpError(404, '资源不存在');
    await problemPermission(req.user,asset.problemId);
    return reply.type(asset.mediaType).send(await storage.get(asset.key));
  });
}
