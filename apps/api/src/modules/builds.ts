import { Type } from '@sinclair/typebox';
import { BuildInput, PublishInput } from '@problemforge/contracts';
import { db, type Build } from '@problemforge/database';
import { config, hashObject, HttpError, problemAccess, problemPermission, documentAccess, contestAccess, texQueue, token, audit, taskQuota, recoverTasks, checkRetry } from '@problemforge/domain';
import { validateBody, templateLanguages, printableSample, POLICY_VERSION, TEX_PROFILE, SAMPLE_RENDERER_VERSION, type TemplateFiles } from '@problemforge/template-engine';
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
export async function buildAccess(req: { user: { id: string; role: string } }, build: Pick<Build, 'purpose' | 'contestId' | 'documentId' | 'problemId'>) {
  if (build.purpose === 'TEMPLATE_VALIDATION') {
    if (req.user.role !== 'ADMIN') throw new HttpError(404, '构建不存在或无访问权限');
  } else if(build.contestId) await contestAccess(req.user,build.contestId);
  else if(build.documentId){const doc=await db.document.findUnique({where:{id:build.documentId}});if(!doc)throw new HttpError(404,'文稿不存在');await documentAccess(req.user,doc.problemId,doc.language);}
  else if (build.problemId) await problemAccess(req.user, build.problemId);
  else throw new HttpError(404, '构建不存在');
}
const access = buildAccess;
async function writeAccess(req:{user:{id:string;role:string}},build:Build){
  if(build.contestId)await contestAccess(req.user,build.contestId,true);
  else if(build.documentId){const doc=await db.document.findUniqueOrThrow({where:{id:build.documentId}});await documentAccess(req.user,doc.problemId,doc.language,true);}
  else if(build.problemId)await problemAccess(req.user,build.problemId,true);
}
async function staleBuild(build:Build){
  if(build.contestId){const [contest,revision]=await Promise.all([db.contest.findUnique({where:{id:build.contestId}}),build.contestRevisionId?db.contestRevision.findUnique({where:{id:build.contestRevisionId}}):null]);return !contest||!revision||hashObject((revision.data as unknown as {selection:unknown}).selection)!==hashObject(contest.data);}
  const doc=build.documentId?await db.document.findUnique({where:{id:build.documentId}}):null;
  return !!doc&&(doc.currentRevisionId!==build.revisionId||doc.templateVersionId!==build.templateVersionId||!doc.enabled);
}
export async function buildRoutes(app: Api) {
  let reconciling = false;
  const reconciliation = setInterval(async () => {
    if (reconciling) return; reconciling = true;
    try { await recoverTasks('tex', queue); }
    catch (e) { app.log.error(e); } finally { reconciling = false; }
  }, 5000);
  reconciliation.unref();
  app.addHook('onClose', async () => { clearInterval(reconciliation); await queue.close(); });
  app.post('/api/builds', { preHandler: authenticate, schema: { body: BuildInput, tags: ['构建'] } }, async req => {
    const doc = await db.document.findUnique({ where: { id: req.body.documentId }, include: { currentRevision: true, templateVersion: { include: { template: true } } } });
    if (!doc) throw new HttpError(404, '文稿不存在'); await documentAccess(req.user, doc.problemId,doc.language,true);
    if (!doc.enabled || !doc.currentRevision || !doc.templateVersion) throw new HttpError(422, '文稿必须启用、有正文且已选择模板');
    if (!['PUBLISHED', 'ARCHIVED'].includes(doc.templateVersion.state)) throw new HttpError(422, `模板版本不可构建：${doc.templateVersion.reason ?? doc.templateVersion.state}`);
    if (!templateLanguages(doc.templateVersion.files as TemplateFiles).includes(doc.language)) throw new HttpError(422, '模板没有声明支持本语言');
    const assets = await db.asset.findMany({ where: { problemId: doc.problemId } });
    const used = validateBody(doc.currentRevision.body, doc.kind, assets.map(assetPath));
    const assetSnapshot = assets.filter(a => used.includes(assetPath(a))).map(a => ({ path: assetPath(a), key: a.key, hash: a.hash, bytes: a.bytes }));
    const samples = [];
    for (const [i, revisionId] of doc.currentRevision.sampleRevisionIds.entries()) {
      const sample = await db.testCaseRevision.findUnique({ where: { id: revisionId }, include: { testCase: true } });
      if (!sample || sample.testCase.problemId !== doc.problemId || !sample.answerKey || !(sample.configuration as { isSample: boolean }).isSample) throw new HttpError(422, '题面样例的数据版本不完整或不属于本题');
      try { printableSample(await storage.get(sample.inputKey)); printableSample(await storage.get(sample.answerKey)); } catch (e) { throw new HttpError(422, (e as Error).message); }
      samples.push({ revisionId, inputPath: `samples/sample-${i + 1}.in`, answerPath: `samples/sample-${i + 1}.ans`, input: { key: sample.inputKey, hash: sample.inputHash, bytes: sample.inputBytes }, answer: { key: sample.answerKey, hash: sample.answerHash!, bytes: sample.answerBytes! } });
    }
    const input = { kind: doc.kind, language: doc.language, body: doc.currentRevision.body, metadata: doc.currentRevision.metadata,
      files: doc.templateVersion.files as TemplateFiles, templateHash: doc.templateVersion.hash, contentHash: doc.currentRevision.hash,
      revisionId: doc.currentRevision.id, contentVersion: doc.version, templateNumber: doc.templateVersion.number, assets: assetSnapshot, samples,
      ...(samples.length ? { sampleRendererVersion: SAMPLE_RENDERER_VERSION } : {}),
      policy: POLICY_VERSION, toolchain: TEX_PROFILE, sandboxVersion: GO_JUDGE_VERSION };
    const inputHash = hashObject(input), requestKey = req.body.requestKey ? hashObject([req.user.id, 'build', req.body.requestKey]) : hashObject([req.user.id, 'build', doc.id, inputHash]);
    const build = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.user.id} FOR UPDATE`;
      const old = await tx.build.findUnique({where:{requestKey}});
      if (old) { if(old.inputHash!==inputHash||old.documentId!==doc.id)throw new HttpError(409,'提交键已用于另一个构建'); return old; }
      await taskQuota(tx,req.user.id,'tex');
      return tx.build.create({ data: { requestKey, requestedById: req.user.id, problemId: doc.problemId, documentId: doc.id, revisionId: doc.currentRevision!.id,
        templateVersionId: doc.templateVersion!.id, kind: doc.kind, input, inputHash } });
    });
    await scheduleBuild(build.id); await audit(req.user.id,'CREATE_BUILD',build.id); return build;
  });
  app.get('/api/builds', { preHandler: authenticate, schema: { querystring: Type.Object({ problemId: Type.Optional(Type.String()) }, { additionalProperties: false }) } }, async req => {
    if (req.query.problemId) await problemPermission(req.user, req.query.problemId);
    const builds = await db.build.findMany({
      where: req.query.problemId ? { problemId: req.query.problemId } : { requestedById: req.user.id, ...(req.user.role !== 'ADMIN' ? { purpose: {in:['DOCUMENT','CONTEST']} } : {}) },
      include: { artifacts: true }, orderBy: { createdAt: 'desc' }, take: 50,
    });
    const visible: (Build & { artifacts: unknown[]; stale: boolean })[] = [];
    for (const build of builds) {
      try { await access(req, build); } catch { continue; }
      visible.push({ ...build, input: { contentVersion: (build.input as Record<string, unknown>).contentVersion, templateNumber: (build.input as Record<string, unknown>).templateNumber } as Build['input'], stale: await staleBuild(build) });
    }
    return visible;
  });
  app.get('/api/builds/:id', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const build = await db.build.findUnique({ where: { id: req.params.id }, include: { artifacts: true } });
    if (!build) throw new HttpError(404, '构建不存在'); await access(req, build);
    return { ...build, stale: await staleBuild(build) };
  });
  app.post('/api/builds/:id/cancel', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const build = await db.build.findUnique({ where: { id: req.params.id } });
    if (!build) throw new HttpError(404, '构建不存在'); await access(req, build);
    await writeAccess(req,build);
    await db.build.updateMany({ where: { id: build.id, state: 'QUEUED' }, data: { cancelRequested: true, state:'CANCELED',finishedAt:new Date() } });
    await db.build.updateMany({ where: { id: build.id, state: 'RUNNING' }, data: { cancelRequested: true } }); await audit(req.user.id,'CANCEL_BUILD',build.id); return { ok: true };
  });
  app.post('/api/builds/:id/retry', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const old = await db.build.findUnique({ where: { id: req.params.id } });
    if (!old) throw new HttpError(404, '构建不存在'); await access(req, old);
    await writeAccess(req,old);
    if (!['FAILED', 'CANCELED'].includes(old.state)) throw new HttpError(409, '只有失败或取消的任务可以单独重试');
    const version = await db.templateVersion.findUnique({ where: { id: old.templateVersionId } });
    if (!version || version.state === 'REVOKED' || (old.purpose === 'TEMPLATE_VALIDATION' && (version.hash !== (old.input as Record<string, unknown>).templateHash || !['DRAFT', 'VALIDATED'].includes(version.state)))) throw new HttpError(409, '模板已撤回或草稿已改变，请新建构建');
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Build" WHERE id=${old.id} FOR UPDATE`;
      const previous=await tx.build.findUnique({where:{retryOfId:old.id}});if(previous)return previous;
      checkRetry(old.retryCount);await taskQuota(tx,req.user.id,'tex');
      return tx.build.create({ data: { retryOfId:old.id,retryCount:old.retryCount+1,requestedById: req.user.id, problemId: old.problemId, documentId: old.documentId, revisionId: old.revisionId,contestId:old.contestId,contestRevisionId:old.contestRevisionId,bundleId:old.bundleId,
        templateVersionId: old.templateVersionId, kind: old.kind, purpose: old.purpose, input: old.input!, inputHash: old.inputHash } });
    });await audit(req.user.id,'RETRY_BUILD',result.id,{from:old.id});
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
