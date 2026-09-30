import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import { AssetInput } from '@problemforge/contracts';
import { db } from '@problemforge/database';
import { HttpError, sha256, problemAccess, audit } from '@problemforge/domain';
import { authenticate, storage, type Api } from '../app.ts';

export function assetPath(asset: { id: string; mediaType: string }) {
  return `assets/${asset.id}.${asset.mediaType === 'image/png' ? 'png' : 'jpg'}`;
}
export async function assetRoutes(app: Api) {
  app.get('/api/problems/:id/assets', { preHandler: authenticate, schema: { params: Type.Object({ id: Type.String() }) } }, async req => {
    await problemAccess(req.user, req.params.id);
    return (await db.asset.findMany({ where: { problemId: req.params.id }, orderBy: { createdAt: 'desc' } })).map(a => ({ id: a.id, name: a.name, bytes: a.bytes, hash: a.hash, mediaType: a.mediaType, path: assetPath(a) }));
  });
  app.post('/api/problems/:id/assets', { preHandler: authenticate, schema: { params: Type.Object({ id: Type.String() }), body: AssetInput } }, async req => {
    await problemAccess(req.user, req.params.id, true);
    const bytes = Buffer.from(req.body.base64, 'base64');
    if (bytes.length > 1_000_000 || bytes.toString('base64') !== req.body.base64) throw new HttpError(422, '图片必须是规范 Base64 且不超过 1MB');
    let mediaType: string;
    if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.subarray(12, 16).toString() === 'IHDR') {
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      if (!width || !height || width * height > 16_000_000) throw new HttpError(422, 'PNG 图像尺寸超出范围');
      mediaType = 'image/png';
    } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.subarray(-2).equals(Buffer.from([255, 217]))) mediaType = 'image/jpeg';
    else throw new HttpError(422, '本阶段资源支持 PNG / JPEG；不接受 SVG、脚本或 TeX 文件');
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
    await problemAccess(req.user, asset.problemId);
    return reply.type(asset.mediaType).send(await storage.get(asset.key));
  });
}
