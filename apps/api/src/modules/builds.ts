import { Type } from '@sinclair/typebox';
import { BuildInput, PublishInput } from '@problemforge/contracts';
import { db, type Build } from '@problemforge/database';
import { config, hashObject, HttpError, problemAccess, texQueue, token, audit } from '@problemforge/domain';
import { validateBody, templateLanguages, POLICY_VERSION, TEX_PROFILE, type TemplateFiles } from '@problemforge/template-engine';
import { GO_JUDGE_VERSION } from '@problemforge/judge-adapter';
import { admin, authenticate, storage, type Api } from '../app.ts';
import { assetPath } from './assets.ts';

const Id = Type.Object({ id: Type.String() });
const queue = texQueue();
queue.on('error', e => console.error('TeX queue:', e.message));
export async function scheduleBuild(id: string) {
  try {
    await queue.add('compile', { buildId: id }, { jobId: id });
    await db.build.updateMany({ where: { id, state: 'QUEUED' }, data: { queuedAt: new Date() } });
  } catch (error) {
    // DB is the durable outbox. Reconciliation retries enqueue, never compiles on API.
    await db.build.updateMany({ where: { id, state: 'QUEUED' }, data: { log: `入队暂未完成：${(error as Error).message}\n后台将重试入队。` } });
  }
}
async function access(req: { user: { id: string; role: string } }, build: Build) {
  if (build.purpose === 'TEMPLATE_VALIDATION') {
    if (req.user.role !== 'ADMIN') throw new HttpError(404, '构建不存在或无访问权限');
  } else if (build.problemId) await problemAccess(req.user, build.problemId);
  else throw new HttpError(404, '构建不存在');
}
export async function buildRoutes(app: Api) {
  const reconciliation = setInterval(async () => {
    try { for (const b of await db.build.findMany({ where: { state: 'QUEUED', queuedAt: null }, take: 25 })) await scheduleBuild(b.id); }
    catch (e) { app.log.error(e); }
  }, 5000);
  reconciliation.unref();
  app.addHook('onClose', async () => { clearInterval(reconciliation); await queue.close(); });
  app.post('/api/builds', { preHandler: authenticate, schema: { body: BuildInput, tags: ['构建'] } }, async req => {
    const doc = await db.document.findUnique({ where: { id: req.body.documentId }, include: { currentRevision: true, templateVersion: { include: { template: true } } } });
    if (!doc) throw new HttpError(404, '文稿不存在'); await problemAccess(req.user, doc.problemId, true);
    if (!doc.enabled || !doc.currentRevision || !doc.templateVersion) throw new HttpError(422, '文稿必须启用、有正文且已选择模板');
    if (!['PUBLISHED', 'ARCHIVED'].includes(doc.templateVersion.state)) throw new HttpError(422, `模板版本不可构建：${doc.templateVersion.reason ?? doc.templateVersion.state}`);
    if (!templateLanguages(doc.templateVersion.files as TemplateFiles).includes(doc.language)) throw new HttpError(422, '模板没有声明支持本语言');
    const assets = await db.asset.findMany({ where: { problemId: doc.problemId } });
    const used = validateBody(doc.currentRevision.body, doc.kind, assets.map(assetPath));
    const assetSnapshot = assets.filter(a => used.includes(assetPath(a))).map(a => ({ path: assetPath(a), key: a.key, hash: a.hash, bytes: a.bytes }));
    const input = { kind: doc.kind, language: doc.language, body: doc.currentRevision.body, metadata: doc.currentRevision.metadata,
      files: doc.templateVersion.files as TemplateFiles, templateHash: doc.templateVersion.hash, contentHash: doc.currentRevision.hash,
      revisionId: doc.currentRevision.id, contentVersion: doc.version, templateNumber: doc.templateVersion.number, assets: assetSnapshot,
      policy: POLICY_VERSION, toolchain: TEX_PROFILE, sandboxVersion: GO_JUDGE_VERSION };
    const active = await db.build.count({ where: { requestedById: req.user.id, state: { in: ['QUEUED', 'RUNNING'] } } });
    if (active >= 6) throw new HttpError(429, '每个用户最多同时排队/执行六个文档构建');
    const build = await db.build.create({ data: { requestedById: req.user.id, problemId: doc.problemId, documentId: doc.id, revisionId: doc.currentRevision.id,
      templateVersionId: doc.templateVersion.id, kind: doc.kind, input, inputHash: hashObject(input) } });
    await scheduleBuild(build.id); return build;
  });
  app.get('/api/builds', { preHandler: authenticate, schema: { querystring: Type.Object({ problemId: Type.Optional(Type.String()) }, { additionalProperties: false }) } }, async req => {
    if (req.query.problemId) await problemAccess(req.user, req.query.problemId);
    const builds = await db.build.findMany({
      where: req.query.problemId ? { problemId: req.query.problemId } : { requestedById: req.user.id, ...(req.user.role !== 'ADMIN' ? { purpose: 'DOCUMENT' } : {}) },
      include: { artifacts: true }, orderBy: { createdAt: 'desc' }, take: 50,
    });
    const visible: (Build & { artifacts: unknown[]; stale: boolean })[] = [];
    for (const build of builds) {
      try { await access(req, build); } catch { continue; }
      const doc = build.documentId ? await db.document.findUnique({ where: { id: build.documentId } }) : null;
      visible.push({ ...build, input: { contentVersion: (build.input as Record<string, unknown>).contentVersion, templateNumber: (build.input as Record<string, unknown>).templateNumber } as Build['input'], stale: !!doc && (doc.currentRevisionId !== build.revisionId || doc.templateVersionId !== build.templateVersionId || !doc.enabled) });
    }
    return visible;
  });
  app.get('/api/builds/:id', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const build = await db.build.findUnique({ where: { id: req.params.id }, include: { artifacts: true } });
    if (!build) throw new HttpError(404, '构建不存在'); await access(req, build);
    const doc = build.documentId ? await db.document.findUnique({ where: { id: build.documentId } }) : null;
    return { ...build, stale: !!doc && (doc.currentRevisionId !== build.revisionId || doc.templateVersionId !== build.templateVersionId || !doc.enabled) };
  });
  app.post('/api/builds/:id/cancel', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const build = await db.build.findUnique({ where: { id: req.params.id } });
    if (!build) throw new HttpError(404, '构建不存在'); await access(req, build);
    if (build.problemId) await problemAccess(req.user, build.problemId, true);
    await db.build.updateMany({ where: { id: build.id, state: { in: ['QUEUED', 'RUNNING'] } }, data: { cancelRequested: true } }); return { ok: true };
  });
  app.post('/api/builds/:id/retry', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const old = await db.build.findUnique({ where: { id: req.params.id } });
    if (!old) throw new HttpError(404, '构建不存在'); await access(req, old);
    if (old.problemId) await problemAccess(req.user, old.problemId, true);
    if (!['FAILED', 'CANCELED'].includes(old.state)) throw new HttpError(409, '只有失败或取消的任务可以单独重试');
    const version = await db.templateVersion.findUnique({ where: { id: old.templateVersionId } });
    if (!version || version.state === 'REVOKED' || (old.purpose === 'TEMPLATE_VALIDATION' && (version.hash !== (old.input as Record<string, unknown>).templateHash || !['DRAFT', 'VALIDATED'].includes(version.state)))) throw new HttpError(409, '模板已撤回或草稿已改变，请新建构建');
    const result = await db.build.create({ data: { requestedById: req.user.id, problemId: old.problemId, documentId: old.documentId, revisionId: old.revisionId,
      templateVersionId: old.templateVersionId, kind: old.kind, purpose: old.purpose, input: old.input!, inputHash: old.inputHash } });
    await scheduleBuild(result.id); return result;
  });
  app.get('/api/artifacts/:id/pdf', { preHandler: authenticate, schema: { params: Id } }, async (req, reply) => {
    const artifact = await db.artifact.findUnique({ where: { id: req.params.id }, include: { build: true } });
    if (!artifact) throw new HttpError(404, '产物不存在'); await access(req, artifact.build);
    const pdf = await storage.get(artifact.key);
    return reply.type('application/pdf').header('Content-Disposition', `inline; filename="${artifact.build.kind}-${artifact.build.id}.pdf"`).send(pdf);
  });
  app.post('/api/documents/:id/publish', { preHandler: authenticate, schema: { params: Id, body: PublishInput } }, async req => {
    const doc = await db.document.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new HttpError(404, '文稿不存在');
    const role = await problemAccess(req.user, doc.problemId);
    if (role !== 'OWNER' && req.user.role !== 'ADMIN') throw new HttpError(403, '只有题目负责人可以发布');
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${doc.id} FOR UPDATE`;
      const current = await tx.document.findUniqueOrThrow({ where: { id: doc.id } });
      const build = await tx.build.findUnique({ where: { id: req.body.buildId }, include: { artifacts: true } });
      const template = current.templateVersionId ? await tx.templateVersion.findUnique({ where: { id: current.templateVersionId } }) : null;
      if (!current.enabled || !build || build.documentId !== current.id || build.state !== 'SUCCEEDED' || build.revisionId !== current.currentRevisionId || build.templateVersionId !== current.templateVersionId || !build.artifacts.length || template?.state === 'REVOKED') throw new HttpError(409, '必须发布当前文稿和模板对应的成功构建，模板不能已撤回');
      return tx.publication.create({ data: { documentId: current.id, buildId: build.id, token: token() } });
    });
    await audit(req.user.id, 'PUBLISH_DOCUMENT', doc.id, { kind: doc.kind, buildId: req.body.buildId });
    return { ...result, url: `${config.origin}/api/published/${result.token}/pdf` };
  });
  app.post('/api/publications/:id/revoke', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const publication = await db.publication.findUnique({ where: { id: req.params.id }, include: { document: true } });
    if (!publication) throw new HttpError(404, '发布不存在');
    const role = await problemAccess(req.user, publication.document.problemId);
    if (role !== 'OWNER' && req.user.role !== 'ADMIN') throw new HttpError(403, '只有题目负责人可以撤回');
    await db.publication.update({ where: { id: publication.id }, data: { revokedAt: new Date() } });
    await audit(req.user.id, 'REVOKE_PUBLICATION', publication.id); return { ok: true };
  });
  app.get('/api/published/:token/pdf', { schema: { params: Type.Object({ token: Type.String() }) } }, async (req, reply) => {
    const publication = await db.publication.findUnique({ where: { token: req.params.token }, include: { build: { include: { artifacts: true } } } });
    if (!publication || publication.revokedAt) throw new HttpError(404, '资料未发布或已经撤回');
    const artifact = publication.build.artifacts[0]; if (!artifact) throw new HttpError(404, '产物不存在');
    return reply.type('application/pdf').header('Content-Disposition', `inline; filename="${publication.build.kind}.pdf"`).send(await storage.get(artifact.key));
  });
}
