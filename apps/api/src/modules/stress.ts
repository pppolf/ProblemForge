import { Type } from '@sinclair/typebox';
import { StressConfigUpdateInput } from '@problemforge/contracts';
import { db } from '@problemforge/database';
import { audit, hashObject, HttpError, problemAccess } from '@problemforge/domain';
import { authenticate, type Api } from '../app.ts';
import { lockProblem, touchProblem } from './judge-data.ts';
import { judgeSnapshot, validateJudgeSnapshot } from './judge-snapshot.ts';
const Id = Type.Object({ id: Type.String() });
export async function stressRoutes(app: Api) {
  app.get('/api/problems/:id/stress-config', { preHandler: authenticate, schema: { params: Id } }, async req => {
    await problemAccess(req.user, req.params.id);
    return await db.stressConfig.findUnique({ where: { problemId: req.params.id } }) ?? { version: 0, data: null };
  });
  app.put('/api/problems/:id/stress-config', { preHandler: authenticate, schema: { params: Id, body: StressConfigUpdateInput } }, async req => {
    await problemAccess(req.user, req.params.id, true);
    const result = await db.$transaction(async tx => {
      await lockProblem(tx, req.params.id);
      const old = await tx.stressConfig.findUnique({ where: { problemId: req.params.id } });
      if ((old?.version ?? 0) !== req.body.expectedVersion) throw new HttpError(409, '对拍配置版本冲突，本地修改保留', 'VERSION_CONFLICT');
      const data = req.body.data, version = req.body.expectedVersion + 1, hash = hashObject(data);
      const saved = await tx.stressConfig.upsert({ where: { problemId: req.params.id }, create: { problemId: req.params.id, data, version, hash }, update: { data, version, hash } });
      validateJudgeSnapshot(await judgeSnapshot(tx, req.params.id, 'STRESS'));
      await tx.stressConfigRevision.create({ data: { problemId: req.params.id, version, data, hash } });
      await touchProblem(tx, req.params.id); return saved;
    });
    await audit(req.user.id, 'SAVE_STRESS_CONFIG', req.params.id, { version: result.version }); return result;
  });
}
