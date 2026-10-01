import { Type } from '@sinclair/typebox';
import { resolve } from 'node:path';
import { TemplateInput, TemplateDraftInput, ReasonInput, Kind } from '@problemforge/contracts';
import { db } from '@problemforge/database';
import { hashObject, HttpError, audit, root } from '@problemforge/domain';
import { validateTemplate, applyAdminStyle, templateLanguages, type TemplateFiles, POLICY_VERSION, TEX_PROFILE, CONTEST_RENDERER_VERSION, ContentPolicyError } from '@problemforge/template-engine';
import { GO_JUDGE_VERSION } from '@problemforge/judge-adapter';
import { admin, authenticate, type Api } from '../app.ts';
import { taskQuota } from '@problemforge/domain';
import { scheduleBuild } from './builds.ts';

const Id = Type.Object({ id: Type.String() });
function checkFiles(files: TemplateFiles, kind: Parameters<typeof validateTemplate>[1]) {
  try { validateTemplate(files, kind); } catch (e) { if (e instanceof ContentPolicyError) throw e; throw new HttpError(422, (e as Error).message, 'TEMPLATE_PROTOCOL'); }
}
export async function templateRoutes(app: Api) {
  app.get('/api/admin/template-starters/:kind', { preHandler: admin, schema: { params: Type.Object({ kind: Kind }) } }, async req => {
    const folders: Record<string, string> = { STATEMENT: 'statement', EDITORIAL_DOCUMENT: 'editorial-document', EDITORIAL_BEAMER: 'editorial-beamer' };
    const path = resolve(root, 'templates/builtin', folders[req.params.kind]);
    const { loadTemplateDirectory } = await import('@problemforge/template-engine');
    return { files: await loadTemplateDirectory(path) };
  });
  app.get('/api/templates', { preHandler: authenticate }, async () => (await db.templateVersion.findMany({
    where: { state: 'PUBLISHED' }, select: { id: true, number: true, hash: true, files: true, template: { select: { id: true, name: true, kind: true } } }, orderBy: { publishedAt: 'desc' },
  })).map(({ files, ...version }) => ({ ...version, languages: templateLanguages(files as TemplateFiles),contestCapable:!!(files as TemplateFiles)['booklet.tex']?.includes('{{CONTENTS}}')&&!!(files as TemplateFiles)['item.tex'] })));
  app.get('/api/admin/templates', { preHandler: admin }, async () => db.template.findMany({ include: { versions: { orderBy: { number: 'desc' } } }, orderBy: { createdAt: 'desc' } }));
  app.post('/api/admin/templates', { preHandler: admin, schema: { body: TemplateInput, tags: ['管理员模板'] } }, async req => {
    const created = await db.template.create({ data: req.body }); await audit(req.user.id, 'CREATE_TEMPLATE', created.id); return created;
  });
  app.post('/api/admin/templates/:id/versions', { preHandler: admin, bodyLimit: 10_500_000, schema: { params: Id, body: TemplateDraftInput } }, async req => {
    const template = await db.template.findUnique({ where: { id: req.params.id } });
    if (!template) throw new HttpError(404, '模板不存在');
    const files = req.body.styleConfig ? applyAdminStyle(req.body.files, template.kind, req.body.styleConfig) : req.body.files;
    checkFiles(files, template.kind);
    const result = await db.$transaction(async tx => {
      // Serializes version allocation for one template without globally locking builds.
      await tx.$queryRaw`SELECT id FROM "Template" WHERE id = ${template.id} FOR UPDATE`;
      const latest = await tx.templateVersion.findFirst({ where: { templateId: template.id }, orderBy: { number: 'desc' } });
      return tx.templateVersion.create({ data: { templateId: template.id, number: (latest?.number ?? 0) + 1, files, hash: hashObject(files), styleConfig: req.body.styleConfig } });
    });
    await audit(req.user.id, 'CREATE_TEMPLATE_VERSION', result.id); return result;
  });
  app.put('/api/admin/template-versions/:id', { preHandler: admin, bodyLimit: 10_500_000, schema: { params: Id, body: TemplateDraftInput } }, async req => {
    const version = await db.templateVersion.findUnique({ where: { id: req.params.id }, include: { template: true } });
    if (!version) throw new HttpError(404, '模板版本不存在');
    if (!['DRAFT', 'VALIDATED'].includes(version.state)) throw new HttpError(409, '发布版本不可修改，请创建新草稿');
    if (!req.body.expectedVersion) throw new HttpError(400, '编辑需要 expectedVersion');
    const files = req.body.styleConfig ? applyAdminStyle(req.body.files, version.template.kind, req.body.styleConfig) : req.body.files;
    checkFiles(files, version.template.kind);
    const saved = await db.$transaction(async tx => {
    const changed = await tx.templateVersion.updateMany({ where: { id: version.id, editVersion: req.body.expectedVersion, state: { in: ['DRAFT', 'VALIDATED'] } }, data: {
      files, hash: hashObject(files), styleConfig: req.body.styleConfig, editVersion: { increment: 1 }, state: 'DRAFT', validationBuildId: null, validationBuildHash: null,
    } });
    if (!changed.count) throw new HttpError(409, '模板草稿已更新，请重新加载', 'VERSION_CONFLICT');
    return tx.templateVersion.findUniqueOrThrow({ where: { id: version.id } });
    });
    await audit(req.user.id, 'EDIT_TEMPLATE_VERSION', version.id);
    return saved;
  });
  app.post('/api/admin/template-versions/:id/validate', { preHandler: admin, schema: { params: Id } }, async req => {
    const version = await db.templateVersion.findUnique({ where: { id: req.params.id }, include: { template: true } });
    if (!version || !['DRAFT', 'VALIDATED'].includes(version.state)) throw new HttpError(409, '只有草稿或待确认版本可以验证');
    const files = version.files as TemplateFiles; checkFiles(files, version.template.kind);
    const multi=!!files['booklet.tex']?.includes('{{CONTENTS}}');
    const input = { kind: version.template.kind, mode: multi?'contest':files['booklet.tex'] ? 'booklet' : 'single', body: files['preview.tex'], metadata: { title: 'A + B', author: 'ProblemForge' }, files,
      ...(multi?{contestRendererVersion:CONTEST_RENDERER_VERSION,contest:{title:'ProblemForge 比赛预览',author:'ProblemForge',stage:'模板验证',dateHeader:'2026/10/01',dateCover:'2026 年 10 月 1 日',entries:[{namespace:'p1',code:'A',body:files['preview.tex'],metadata:{title:'A + B',author:'ProblemForge'},assetPaths:[],samples:[],timeLimitMs:1000,memoryLimitMb:256,inputFile:'standard input',outputFile:'standard output'}]}}:{}),
      templateHash: version.hash, contentHash: hashObject(files['preview.tex']), policy: POLICY_VERSION, toolchain: TEX_PROFILE, sandboxVersion: GO_JUDGE_VERSION };
    const requestKey=hashObject([req.user.id,'template-validation',version.id,input]);
    const build=await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.user.id} FOR UPDATE`;
      const old=await tx.build.findUnique({where:{requestKey}});if(old)return old;
      await taskQuota(tx,req.user.id,'tex');
      return tx.build.create({ data: { requestKey,requestedById: req.user.id, templateVersionId: version.id, kind: version.template.kind, purpose: 'TEMPLATE_VALIDATION', input, inputHash: hashObject(input) } });
    });
    await scheduleBuild(build.id); return build;
  });
  app.post('/api/admin/template-versions/:id/publish', { preHandler: admin, schema: { params: Id, body: Type.Object({ reviewedBuildId: Type.String() }, { additionalProperties: false }) } }, async req => {
    const version = await db.templateVersion.findUnique({ where: { id: req.params.id } });
    if (!version || version.state !== 'VALIDATED' || version.validationBuildHash !== version.hash || version.validationBuildId !== req.body.reviewedBuildId) throw new HttpError(409, '当前版本必须真实编译通过并确认对应预览');
    const build = await db.build.findUnique({ where: { id: version.validationBuildId }, include: { artifacts: true } });
    if (!build || build.state !== 'SUCCEEDED' || !build.artifacts.length) throw new HttpError(409, '验证 PDF 不可用');
    const changed = await db.templateVersion.updateMany({ where: { id: version.id, state: 'VALIDATED', hash: version.hash, editVersion: version.editVersion, validationBuildId: version.validationBuildId }, data: { state: 'PUBLISHED', publishedAt: new Date() } });
    if (!changed.count) throw new HttpError(409, '模板在确认期间发生变化，请重新验证预览');
    await audit(req.user.id, 'PUBLISH_TEMPLATE_VERSION', version.id); return db.templateVersion.findUniqueOrThrow({ where: { id: version.id } });
  });
  app.post('/api/admin/template-versions/:id/archive', { preHandler: admin, schema: { params: Id } }, async req => {
    const result = await db.templateVersion.updateMany({ where: { id: req.params.id, state: 'PUBLISHED' }, data: { state: 'ARCHIVED' } });
    if (!result.count) throw new HttpError(409, '只有已发布版本可以归档'); await audit(req.user.id, 'ARCHIVE_TEMPLATE_VERSION', req.params.id); return { ok: true };
  });
  app.post('/api/admin/template-versions/:id/revoke', { preHandler: admin, schema: { params: Id, body: ReasonInput } }, async req => {
    const result = await db.templateVersion.updateMany({ where: { id: req.params.id, state: { in: ['PUBLISHED', 'ARCHIVED'] } }, data: { state: 'REVOKED', reason: req.body.reason } });
    if (!result.count) throw new HttpError(409, '版本不在可撤回状态'); await audit(req.user.id, 'REVOKE_TEMPLATE_VERSION', req.params.id, req.body); return { ok: true };
  });
}
