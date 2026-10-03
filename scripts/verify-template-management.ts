import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db, Prisma } from '@problemforge/database';
import { config, hashObject, root, sha256 } from '@problemforge/domain';
import { kinds } from '@problemforge/contracts';
import { applyAdminStyle, loadTemplateDirectory, type TemplateFiles, POLICY_VERSION, TEX_PROFILE } from '@problemforge/template-engine';
import { GO_JUDGE_VERSION } from '../packages/judge-adapter/src/index.ts';
import { createApp } from '../apps/api/src/app.ts';
import { importTemplateFiles, moveTemplateFile, readTemplateUploads, removeTemplateFile } from '../apps/web/src/template-files.ts';

// Exercise the real routes against the original database without a listener,
// outbound login, queued build or persistent fixture. Every write rolls back.
if (!process.argv.includes('--rollback')) throw new Error('请显式指定 --rollback；仅使用原库的必定回滚事务');
const suffix = randomUUID(), rollback = new Error('ROLLBACK_TEMPLATE_VERIFICATION');
const userIds: string[] = [], templateIds: string[] = [], evidence: string[] = [];
const app = await createApp(false);
try {
  await app.ready();
  await db.$transaction(async tx => {
    const saved: { object: any; method: string; original: any }[] = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      const name = model.name[0].toLowerCase() + model.name.slice(1), target = (db as any)[name], delegate = (tx as any)[name];
      for (const method of ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
        saved.push({ object: target, method, original: target[method] }); target[method] = delegate[method].bind(delegate);
      }
    }
    saved.push({ object: db, method: '$transaction', original: db.$transaction });
    (db as any).$transaction = (fn: (transaction: Prisma.TransactionClient) => unknown) => fn(tx);
    try {
      async function session(role: 'ADMIN' | 'USER') {
        const user = await tx.user.create({ data: { email: `${role}-${suffix}@example.test`, name: 'Template verification fixture', role, passwordHash: 'not-a-login-credential' } });
        userIds.push(user.id);
        const token = randomUUID(), csrf = randomUUID();
        await tx.session.create({ data: { id: sha256(token), csrfToken: csrf, userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
        return { cookie: `pf_session=${token}`, csrf };
      }
      const admin = await session('ADMIN'), ordinary = await session('USER');
      const call = async (method: 'POST' | 'PATCH' | 'PUT' | 'GET', path: string, body?: object, expected = 200, auth: typeof admin | null = admin, headers = {}) => {
        const res = await app.inject({ method, url: `/api${path}`, headers: { origin: config.origin, ...(auth ? { cookie: auth.cookie, 'x-csrf-token': auth.csrf } : {}), ...headers }, ...(body ? { payload: body } : {}) });
        assert.equal(res.statusCode, expected, `${method} ${path}: ${res.body}`); return res.json();
      };
      const folders = { STATEMENT: 'statement', EDITORIAL_DOCUMENT: 'editorial-document', EDITORIAL_BEAMER: 'editorial-beamer' };
      for (const kind of kinds) {
        const styleConfig = { marginMm: 28, palette: 'BLUE' as const, cjkFont: kind === 'EDITORIAL_BEAMER' ? 'Noto Sans CJK SC' as const : 'Noto Serif CJK SC' as const };
        const files = applyAdminStyle(await loadTemplateDirectory(resolve(root, 'templates/builtin', folders[kind])), kind, styleConfig);
        const source = await tx.template.create({ data: { name: `source-${kind}-${suffix}`, kind, versions: { create: [
          { number: 1, files, styleConfig, hash: hashObject(files), state: 'PUBLISHED', publishedAt: new Date(), validationBuildId: `fixture-build-${suffix}`, validationBuildHash: hashObject(files) },
          { number: 2, files: { ...files, 'preview.tex': files['preview.tex'] + '\n% Different later draft' }, hash: 'fixture-later-draft', state: 'DRAFT' },
        ] } }, include: { versions: { orderBy: { number: 'asc' } } } });
        templateIds.push(source.id);
        const selected = source.versions[0], copyPath = `/admin/template-versions/${selected.id}/copy`, renamePath = `/admin/templates/${source.id}`;
        const originalVersions = await tx.templateVersion.findMany({ where: { templateId: source.id }, orderBy: { number: 'asc' } });
        const renameBody = { name: `  改名 ${kind}  `, expectedName: source.name }, copyBody = { name: `  副本 ${kind}  `, expectedVersion: selected.editVersion };
        for (const auth of [null, ordinary]) {
          await call('PATCH', renamePath, renameBody, auth ? 403 : 401, auth);
          await call('POST', copyPath, copyBody, auth ? 403 : 401, auth);
        }
        await call('PATCH', renamePath, renameBody, 403, admin, { 'x-csrf-token': 'wrong' });
        await call('POST', copyPath, copyBody, 403, admin, { origin: 'https://wrong.example' });
        for (const name of ['', ' \n\t ', '名'.repeat(121)]) {
          await call('PATCH', renamePath, { ...renameBody, name }, 400);
          await call('POST', copyPath, { ...copyBody, name }, 400);
        }
        await call('PATCH', renamePath, { ...renameBody, kind: 'STATEMENT' }, 400);
        await call('POST', copyPath, { ...copyBody, state: 'PUBLISHED' }, 400);
        await call('POST', copyPath, { name: copyBody.name }, 400);
        assert.equal((await call('PATCH', renamePath, renameBody)).name, renameBody.name.trim());
        assert.equal((await call('PATCH', renamePath, renameBody, 409)).code, 'VERSION_CONFLICT');

        const copied = await call('POST', copyPath, copyBody);
        templateIds.push(copied.id);
        assert.notEqual(copied.id, source.id); assert.equal(copied.kind, kind); assert.equal(copied.name, copyBody.name.trim());
        assert.equal(copied.versions.length, 1);
        const draft = copied.versions[0];
        assert.notEqual(draft.id, selected.id); assert.equal(draft.templateId, copied.id);
        assert.equal(draft.number, 1); assert.equal(draft.editVersion, 1); assert.equal(draft.state, 'DRAFT');
        assert.deepEqual(draft.files, files); assert.deepEqual(draft.styleConfig, styleConfig); assert.equal(draft.hash, selected.hash);
        for (const field of ['validationBuildId', 'validationBuildHash', 'publishedAt', 'reason']) assert.equal(draft[field], null);
        const visible = await call('GET', '/templates', undefined, 200, ordinary);
        assert.ok(!visible.some((v: any) => v.template.id === copied.id));
        assert.equal(visible.find((v: any) => v.id === selected.id).template.name, renameBody.name.trim());
        await call('POST', `/admin/template-versions/${draft.id}/publish`, { reviewedBuildId: selected.validationBuildId }, 409);
        const editedFiles = { ...draft.files, 'preview.tex': files['preview.tex'] + '\n% Independent copy edit' };
        const edited = await call('PUT', `/admin/template-versions/${draft.id}`, { expectedVersion: draft.editVersion, files: editedFiles });
        assert.equal(edited.editVersion, 2); assert.notEqual(edited.hash, selected.hash); assert.deepEqual(edited.styleConfig, styleConfig);
        const filePath = `/admin/template-versions/${draft.id}`;
        const firstImage = await readFile(resolve(root, 'templates/builtin/statement/images/协会logo.png'));
        const nextImage = await readFile(resolve(root, 'templates/builtin/statement/images/cwnucpc.png'));
        const uploaded = importTemplateFiles(editedFiles, await readTemplateUploads([new File([firstImage], '标志.png'), new File(['% editable source'], 'extra.tex')], 'workspace'));
        for (const auth of [null, ordinary]) await call('PUT', filePath, { expectedVersion: 2, files: uploaded }, auth ? 403 : 401, auth);
        await call('PUT', filePath, { expectedVersion: 2, files: uploaded }, 403, admin, { 'x-csrf-token': 'wrong' });
        const withFiles = await call('PUT', filePath, { expectedVersion: 2, files: uploaded });
        assert.deepEqual(withFiles.files, uploaded); assert.equal(withFiles.state, 'DRAFT');
        // Replacing an image invalidates a previous validation without touching the published source.
        await tx.templateVersion.update({ where: { id: draft.id }, data: { state: 'VALIDATED', validationBuildId: `fixture-validation-${suffix}`, validationBuildHash: withFiles.hash } });
        const replacement = importTemplateFiles(uploaded, await readTemplateUploads([new File([nextImage], 'different-name.png')], '', 'workspace/标志.png'));
        const moved = moveTemplateFile(replacement, 'workspace/extra.tex', 'sections/extra.tex');
        const updatedFiles = removeTemplateFile(moved, 'sections/extra.tex');
        const updated = await call('PUT', filePath, { expectedVersion: 3, files: updatedFiles });
        assert.deepEqual(updated.files, updatedFiles); assert.equal(updated.files['workspace/标志.png'], nextImage.toString('base64'));
        assert.equal(updated.state, 'DRAFT'); assert.equal(updated.validationBuildId, null); assert.equal(updated.validationBuildHash, null);
        assert.notEqual(updated.hash, withFiles.hash); assert.deepEqual(updated.styleConfig, styleConfig);
        await call('PUT', filePath, { expectedVersion: 3, files: uploaded }, 409);
        await call('PUT', filePath, { expectedVersion: 4, files: { ...updatedFiles, 'workspace/标志.png': 'aW52YWxpZA==' } }, 422);
        await call('PUT', filePath, { expectedVersion: 4, files: { ...updatedFiles, '../unsafe.tex': 'unsafe' } }, 422);
        assert.deepEqual((await tx.templateVersion.findUniqueOrThrow({ where: { id: draft.id } })).files, updatedFiles);
        evidence.push(`${kind}: workspace upload and same-path image replacement persisted byte-for-byte, source rename/delete saved atomically, roles/CSRF/invalid-image/unsafe-path/stale-version rejected, prior validation cleared`);
        await call('POST', `/admin/template-versions/${draft.id}/copy`, { name: 'stale copy', expectedVersion: 1 }, 409);
        await call('PUT', `/admin/template-versions/${selected.id}`, { expectedVersion: selected.editVersion, files }, 409);
        assert.deepEqual(await tx.templateVersion.findMany({ where: { templateId: source.id }, orderBy: { number: 'asc' } }), originalVersions);
        evidence.push(`${kind}: administrator-only rename/copy, validated names, stale rename/copy rejected, exact chosen version/files/style copied to independent unpublished v1, edits leave source versions unchanged`);
      }

      const empty = await call('POST', '/admin/templates', { name: '  Empty template  ', kind: 'STATEMENT' });
      templateIds.push(empty.id); assert.equal(empty.name, 'Empty template');
      assert.equal((await call('PATCH', `/admin/templates/${empty.id}`, { name: 'Renamed empty', expectedName: empty.name })).name, 'Renamed empty');
      await call('POST', '/admin/templates', { name: '   ', kind: 'STATEMENT' }, 400);
      await call('PATCH', `/admin/templates/missing-${suffix}`, { name: 'Missing', expectedName: 'old' }, 404);
      await call('POST', `/admin/template-versions/missing-${suffix}/copy`, { name: 'Missing', expectedVersion: 1 }, 404);
      const draftSource = await tx.templateVersion.findFirstOrThrow({ where: { templateId: templateIds[0], number: 2 } });
      for (const state of ['DRAFT', 'VALIDATED', 'ARCHIVED', 'REVOKED'] as const) {
        await tx.templateVersion.update({ where: { id: draftSource.id }, data: { state, reason: state === 'REVOKED' ? 'fixture reason' : null } });
        const copy = await call('POST', `/admin/template-versions/${draftSource.id}/copy`, { name: `Copy ${state}`, expectedVersion: draftSource.editVersion });
        templateIds.push(copy.id);
        assert.equal(copy.versions[0].state, 'DRAFT'); assert.equal(copy.versions[0].reason, null); assert.equal(copy.versions[0].styleConfig, null);
        assert.deepEqual(copy.versions[0].files, draftSource.files as TemplateFiles);
      }
      const audits = await tx.auditLog.findMany({ where: { actorId: userIds[0], action: { in: ['COPY_TEMPLATE', 'RENAME_TEMPLATE'] } } });
      assert.equal(audits.filter(a => a.action === 'RENAME_TEMPLATE').length, 4);
      assert.equal(audits.filter(a => a.action === 'COPY_TEMPLATE').length, 7);
      assert.equal(await tx.build.count({ where: { requestedById: { in: userIds } } }), 0);
      evidence.push('empty-template rename; all source states and null style supported; missing records rejected; provenance audit recorded; no copied validation, publication or build');

      // A terminal fixture exercises result reuse, never enqueues or pretends to
      // compile a PDF. All build/artifact metadata is rolled back with the test.
      const previewFiles = await loadTemplateDirectory(resolve(root, 'templates/builtin/editorial-document'));
      delete previewFiles['booklet.tex'];
      previewFiles['manifest.yaml'] = previewFiles['manifest.yaml'].replace('contest: true', 'contest: false').replace(/^bookletEntry:.*\r?\n?/m, '');
      const templateHash = hashObject(previewFiles);
      const validationTemplate = await tx.template.create({ data: { name: `preview-regression-${suffix}`, kind: 'EDITORIAL_DOCUMENT', versions: { create: { number: 1, files: previewFiles, hash: templateHash } } }, include: { versions: true } });
      templateIds.push(validationTemplate.id);
      const validationVersion = validationTemplate.versions[0], validationPath = `/admin/template-versions/${validationVersion.id}/validate`;
      const input = { kind: 'EDITORIAL_DOCUMENT', mode: 'single', body: previewFiles['preview.tex'], metadata: { title: 'A + B', author: 'ProblemForge' }, files: previewFiles,
        templateHash, contentHash: hashObject(previewFiles['preview.tex']), policy: POLICY_VERSION, toolchain: TEX_PROFILE, sandboxVersion: GO_JUDGE_VERSION };
      const existing = await tx.build.create({ data: { requestedById: userIds[0], templateVersionId: validationVersion.id, kind: 'EDITORIAL_DOCUMENT', purpose: 'TEMPLATE_VALIDATION', state: 'SUCCEEDED',
        input, inputHash: hashObject(input), requestKey: hashObject([userIds[0], 'template-validation', validationVersion.id, input]),
        artifacts: { create: { key: `fixture-preview-${suffix}`, mediaType: 'application/pdf', hash: sha256('metadata fixture only'), bytes: 1 } } }, include: { artifacts: true } });
      for (const auth of [null, ordinary]) await call('POST', validationPath, undefined, auth ? 403 : 401, auth);
      await call('POST', validationPath, undefined, 403, admin, { 'x-csrf-token': 'wrong' });
      for (const editVersion of [1, 2]) {
        if (editVersion === 2) {
          const saved = await call('PUT', `/admin/template-versions/${validationVersion.id}`, { expectedVersion: 1, files: previewFiles });
          assert.equal(saved.validationBuildId, null); assert.equal(saved.state, 'DRAFT'); assert.equal(saved.hash, templateHash);
        }
        const submitted = await call('POST', validationPath);
        assert.equal(submitted.id, existing.id);
        const detail = await call('GET', `/builds/${submitted.id}`);
        assert.equal(detail.state, 'SUCCEEDED'); assert.equal(detail.artifacts[0].id, existing.artifacts[0].id);
        const validated = await tx.templateVersion.findUniqueOrThrow({ where: { id: validationVersion.id } });
        assert.equal(validated.editVersion, editVersion); assert.equal(validated.state, 'VALIDATED');
        assert.equal(validated.validationBuildId, existing.id); assert.equal(validated.validationBuildHash, templateHash);
      }
      assert.equal(await tx.build.count({ where: { requestedById: { in: userIds } } }), 1);
      assert.deepEqual(await tx.build.findUniqueOrThrow({ where: { id: existing.id }, include: { artifacts: true } }), existing);
      await tx.templateVersion.update({ where: { id: validationVersion.id }, data: { state: 'DRAFT', validationBuildId: null, validationBuildHash: null } });
      const validationTransaction = db.$transaction;
      try {
        // Simulate a save after the route reads the version, before its CAS.
        (db as any).$transaction = async (fn: (transaction: Prisma.TransactionClient) => unknown) => {
          await tx.templateVersion.update({ where: { id: validationVersion.id }, data: { editVersion: { increment: 1 } } });
          return fn(tx);
        };
        assert.equal((await call('POST', validationPath, undefined, 409)).code, 'VERSION_CONFLICT');
        assert.equal((await tx.templateVersion.findUniqueOrThrow({ where: { id: validationVersion.id } })).validationBuildId, null);
      } finally { db.$transaction = validationTransaction; }
      await tx.artifact.deleteMany({ where: { buildId: existing.id } });
      for (const state of ['SUCCEEDED', 'FAILED'] as const) {
        await tx.build.update({ where: { id: existing.id }, data: { state } });
        assert.equal((await call('POST', validationPath)).state, state);
        assert.equal((await tx.templateVersion.findUniqueOrThrow({ where: { id: validationVersion.id } })).state, 'DRAFT');
      }
      evidence.push('cached successful validation returns the original PDF; identical-content save restores validation with revision CAS; concurrent edit rejected; failed/missing-artifact results do not validate; one unchanged terminal build, no queued work');
      throw rollback;
    } finally { for (const item of saved.reverse()) item.object[item.method] = item.original; }
  }, { timeout: 45000 }).catch(e => { if (e !== rollback) throw e; });
  assert.equal(await db.user.count({ where: { id: { in: userIds } } }), 0);
  assert.equal(await db.template.count({ where: { id: { in: templateIds } } }), 0);
  assert.equal(await db.build.count({ where: { requestedById: { in: userIds } } }), 0);
  assert.equal(await db.auditLog.count({ where: { actorId: { in: userIds } } }), 0);
  const report = { passed: true, rolledBack: true, evidence };
  await mkdir('.local', { recursive: true });
  await writeFile('.local/verify-template-management.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await app.close(); await db.$disconnect(); }
process.exit(0);
