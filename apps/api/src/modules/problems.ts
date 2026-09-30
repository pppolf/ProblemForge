import { Type } from '@sinclair/typebox';
import { kinds, ProblemInput, DocumentInput, LanguageInput } from '@problemforge/contracts';
import { db, Prisma } from '@problemforge/database';
import { hashObject, HttpError, problemAccess, audit } from '@problemforge/domain';
import { validateBody, ContentPolicyError, templateLanguages, type TemplateFiles } from '@problemforge/template-engine';
import { authenticate, type Api } from '../app.ts';
import { assetPath } from './assets.ts';

const Id = Type.Object({ id: Type.String() });
export async function problemRoutes(app: Api) {
  app.get('/api/problems', { preHandler: authenticate }, async req => db.problem.findMany({
    where: req.user.role === 'ADMIN' ? {} : { members: { some: { userId: req.user.id } } },
    select: { id: true, title: true, archived: true, updatedAt: true, _count: { select: { documents: true } } }, orderBy: { updatedAt: 'desc' },
  }));
  app.post('/api/problems', { preHandler: authenticate, schema: { body: ProblemInput, tags: ['题目'] } }, async req => {
    const problem = await db.$transaction(async tx => {
      const p = await tx.problem.create({ data: { title: req.body.title, members: { create: { userId: req.user.id, role: 'OWNER' } } } });
      for (const kind of kinds) {
        const metadata = { title: req.body.title, author: req.user.name };
        const body = kind === 'EDITORIAL_BEAMER' ? '\\begin{frame}{思路}\n\\begin{itemize}\n\\item 在这里编写讲解内容。\n\\end{itemize}\n\\end{frame}' : kind === 'STATEMENT' ? '在这里编写题目描述。\n\n\\InputFile\n在这里编写输入格式。\n\n\\OutputFile\n在这里编写输出格式。\n' : '\\section*{算法思路}\n在这里编写书面题解。\n\n\\section*{正确性证明}\n\n\\section*{复杂度分析}\n';
        const candidates = await tx.templateVersion.findMany({ where: { state: 'PUBLISHED', template: { kind } }, select: { id: true, files: true }, orderBy: { publishedAt: 'desc' } });
        const template = candidates.find(v => templateLanguages(v.files as TemplateFiles).includes(req.body.language));
        const doc = await tx.document.create({ data: { problemId: p.id, language: req.body.language, kind, templateVersionId: template?.id } });
        const revision = await tx.contentRevision.create({ data: { documentId: doc.id, version: 1, body, metadata, hash: hashObject({ body, metadata }) } });
        await tx.document.update({ where: { id: doc.id }, data: { currentRevisionId: revision.id } });
      }
      return p;
    });
    await audit(req.user.id, 'CREATE_PROBLEM', problem.id); return problem;
  });
  app.get('/api/problems/:id', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const role = await problemAccess(req.user, req.params.id);
    const problem = await db.problem.findUniqueOrThrow({ where: { id: req.params.id }, include: { documents: { include: { currentRevision: true, templateVersion: { select: { id: true, number: true, state: true, template: { select: { name: true, kind: true } } } } }, orderBy: { kind: 'asc' } } } });
    return { ...problem, role };
  });
  app.post('/api/problems/:id/languages', { preHandler: authenticate, schema: { params: Id, body: LanguageInput } }, async req => {
    await problemAccess(req.user, req.params.id, true);
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${req.params.id} FOR UPDATE`;
      if (await tx.document.count({ where: { problemId: req.params.id, language: req.body.language } })) throw new HttpError(409, '本语言已经存在');
      const source = await tx.document.findMany({ where: { problemId: req.params.id }, include: { currentRevision: true }, orderBy: { language: 'asc' } });
      for (const kind of kinds) {
        const old = source.find(d => d.kind === kind)!;
        const binding = old.templateVersionId ? await tx.templateVersion.findUnique({ where: { id: old.templateVersionId } }) : null;
        const compatible = binding?.state === 'PUBLISHED' && templateLanguages(binding.files as TemplateFiles).includes(req.body.language);
        const doc = await tx.document.create({ data: { problemId: req.params.id, language: req.body.language, kind, templateVersionId: compatible ? binding!.id : null, enabled: kind === 'STATEMENT' } });
        // New language is a separate empty draft, never an implicit translation/conversion.
        const body = kind === 'EDITORIAL_BEAMER' ? '\\begin{frame}{ }\n\\end{frame}' : '';
        const metadata = old.currentRevision!.metadata as { title: string; author: string };
        const revision = await tx.contentRevision.create({ data: { documentId: doc.id, version: 1, body, metadata, hash: hashObject({ body, metadata }) } });
        await tx.document.update({ where: { id: doc.id }, data: { currentRevisionId: revision.id } });
      }
      return { language: req.body.language };
    });
    await audit(req.user.id, 'ADD_LANGUAGE', req.params.id, result); return result;
  });
  app.put('/api/documents/:id', { preHandler: authenticate, schema: { params: Id, body: DocumentInput, tags: ['文稿'] } }, async (req, reply) => {
    const document = await db.document.findUnique({ where: { id: req.params.id } });
    if (!document) throw new HttpError(404, '文稿不存在');
    await problemAccess(req.user, document.problemId, true);
    if (req.body.templateVersionId) {
      const tv = await db.templateVersion.findUnique({ where: { id: req.body.templateVersionId }, include: { template: true } });
      if (!tv || tv.template.kind !== document.kind || (tv.id !== document.templateVersionId && tv.state !== 'PUBLISHED')) throw new HttpError(422, '只能选择本类型已发布的管理员模板');
      if (!templateLanguages(tv.files as TemplateFiles).includes(document.language)) throw new HttpError(422, '模板没有声明支持本语言，请选择管理员提供的相应模板');
    }
    const sampleRevisionIds = req.body.sampleRevisionIds ?? [];
    if (document.kind !== 'STATEMENT' && sampleRevisionIds.length) throw new HttpError(422, '只有题面可以引用测试数据样例');
    const saved = await db.$transaction(async tx => {
      if (sampleRevisionIds.length) {
        const samples = await tx.testCaseRevision.findMany({ where: { id: { in: sampleRevisionIds }, testCase: { problemId: document.problemId } } });
        if (samples.length !== sampleRevisionIds.length || samples.some(s => !(s.configuration as { isSample: boolean }).isSample || !s.answerKey)) throw new HttpError(422, '样例必须引用本题标记为样例且已有答案的具体测试数据版本');
      }
      const changed = await tx.document.updateMany({ where: { id: document.id, version: req.body.expectedVersion }, data: { version: { increment: 1 }, enabled: req.body.enabled, templateVersionId: req.body.templateVersionId } });
      if (!changed.count) throw new HttpError(409, '文稿已被其他窗口更新，请重载并合并；您的本地正文仍然保留', 'VERSION_CONFLICT');
      const revision = await tx.contentRevision.create({ data: { documentId: document.id, version: req.body.expectedVersion + 1, body: req.body.body, metadata: req.body.metadata, sampleRevisionIds, hash: hashObject({ body: req.body.body, metadata: req.body.metadata, sampleRevisionIds }) } });
      const result = await tx.document.update({ where: { id: document.id }, data: { currentRevisionId: revision.id }, include: { currentRevision: true } });
      await tx.problem.update({ where: { id: document.problemId }, data: { updatedAt: new Date() } });
      return result;
    });
    let policyIssues: unknown[] = [];
    const paths = (await db.asset.findMany({ where: { problemId: document.problemId } })).map(assetPath);
    try { validateBody(req.body.body, document.kind, paths); } catch (e) { if (e instanceof ContentPolicyError) policyIssues = e.issues; else throw e; }
    reply.header('ETag', `"${saved.version}"`);
    return { ...saved, policyIssues };
  });
  app.get('/api/documents/:id/history', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const doc = await db.document.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new HttpError(404, '文稿不存在'); await problemAccess(req.user, doc.problemId);
    return db.contentRevision.findMany({ where: { documentId: doc.id }, orderBy: { version: 'desc' }, take: 50 });
  });
  app.get('/api/problems/:id/publications', { preHandler: authenticate, schema: { params: Id } }, async req => {
    await problemAccess(req.user, req.params.id);
    return db.publication.findMany({ where: { document: { problemId: req.params.id } }, include: { document: { select: { kind: true, language: true } } }, orderBy: { createdAt: 'desc' } });
  });
}
