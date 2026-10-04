import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { db, Prisma } from '@problemforge/database';
import { config, hashObject, sha256 } from '@problemforge/domain';
import { kinds, defaultJudgeSettings, type ContestDataValue } from '@problemforge/contracts';
import { readArchive } from '@problemforge/problem-format';
import { createApp, storage } from '../apps/api/src/app.ts';
import { problemSnapshot } from '../apps/api/src/modules/revision-snapshot.ts';
import { type FrozenContest } from '../apps/api/src/modules/contest-snapshot.ts';

if (!process.argv.includes('--rollback')) throw new Error('请指定 --rollback；全部数据库夹具回滚，队列和文件只用内存替身');
const { Queue } = createRequire(new URL('../packages/domain/package.json', import.meta.url))('bullmq');
const rollback = new Error('ROLLBACK_CONTEST_SYNC'), users = Array.from({ length: 4 }, () => randomUUID());
const tokens = users.map(() => randomUUID()), csrf = randomUUID(), fixtures: string[] = [], contests: string[] = [];
const savedAdd = Queue.prototype.add, savedPut = storage.put, savedGet = storage.get;
const memory = new Map<string, Buffer>(), scheduled: string[] = [], checks: string[] = [];
Queue.prototype.add = async (_name: string, data: { buildId: string }) => { scheduled.push(data.buildId); return { id: data.buildId }; };
storage.put = async (key, bytes) => { memory.set(key, Buffer.from(bytes)); };
storage.get = async key => { assert(memory.has(key), `Unexpected storage read: ${key}`); return memory.get(key)!; };
const app = await createApp(false);
try {
  await app.ready();
  await db.$transaction(async tx => {
    const saved: { object: any; method: string; original: any }[] = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      const name = model.name[0].toLowerCase() + model.name.slice(1), object = (db as any)[name], delegate = (tx as any)[name];
      for (const method of ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
        saved.push({ object, method, original: object[method] }); object[method] = delegate[method].bind(delegate);
      }
    }
    saved.push({ object: db, method: '$transaction', original: db.$transaction });
    (db as any).$transaction = (fn: (transaction: Prisma.TransactionClient) => unknown) => fn(tx);
    try {
      for (const [index, id] of users.entries()) {
        await tx.user.create({ data: { id, name: 'Contest sync rollback', email: `${id}@example.test`, role: 'USER', passwordHash: 'not-a-login-credential' } });
        await tx.session.create({ data: { id: sha256(tokens[index]), userId: id, csrfToken: csrf, expiresAt: new Date(Date.now() + 180000) } });
      }
      const call = async (method: 'GET' | 'POST' | 'PUT', path: string, payload?: object, expected = 200, actor = 0, withCsrf = true) => {
        const response = await app.inject({ method, url: `/api${path}`, headers: { origin: config.origin, cookie: `pf_session=${tokens[actor]}`, ...(withCsrf ? { 'x-csrf-token': csrf } : {}) }, ...(payload ? { payload } : {}) });
        assert.equal(response.statusCode, expected, `${path}: ${response.body.slice(0, 1000)}`); return response;
      };
      const p = (await call('POST', '/problems', { title: 'Original problem', language: 'zh-CN' })).json(); fixtures.push(p.id);
      const profile = await tx.compileProfile.findFirstOrThrow({ where: { enabled: true, language: 'CPP17' } });
      for (const role of ['MAIN_SOLUTION', 'VALIDATOR']) await call('POST', `/problems/${p.id}/programs`, { name: role, role, profileId: profile.id, source: '// Rollback-only fixture; never executed.', enabled: true, expectedVerdicts: ['AC'], notes: '' });
      const testData = { number: 1, groupName: 'main', isSample: true, enabled: true, notes: '', inputBase64: Buffer.from('1 2\n').toString('base64'), answerBase64: Buffer.from('3\n').toString('base64') };
      let test = (await call('POST', `/problems/${p.id}/tests`, testData)).json();
      const templates = await tx.templateVersion.findMany({ where: { state: 'PUBLISHED' }, include: { template: true } });
      const bindings = Object.fromEntries(kinds.map(kind => [kind, templates.find(t => t.template.kind === kind && (t.files as Record<string, string>)['booklet.tex']?.includes('{{CONTENTS}}'))!.id])) as ContestDataValue['templates'];
      const saveDocument = async (kind: string, body: string, enabled = true) => {
        const doc = await tx.document.findFirstOrThrow({ where: { problemId: p.id, kind: kind as any }, include: { currentRevision: true } });
        return (await call('PUT', `/documents/${doc.id}`, { expectedVersion: doc.version, enabled, body, metadata: { title: 'Updated document title', author: 'Latest author' }, templateVersionId: doc.templateVersionId, sampleRevisionIds: kind === 'STATEMENT' ? [test.currentRevisionId] : [] })).json();
      };
      await saveDocument('STATEMENT', 'Original statement.');
      const accept = async () => {
        const source = await problemSnapshot(tx, p.id); assert(source.judgeHash);
        // Only terminal metadata: this test verifies dependencies, not Judge execution.
        return tx.testRun.create({ data: { problemId: p.id, requestedById: users[0], requestKey: randomUUID(), purpose: 'ACCEPTANCE', state: 'SUCCEEDED', accepted: true, dependencyHash: source.judgeHash, inputHash: 'rollback-fixture', input: { verificationOnly: true }, stage: 'Not executed; rollback-only metadata' } });
      };
      await accept();
      const source = await problemSnapshot(tx, p.id);
      const oldProblem = await tx.problemRevision.create({ data: { problemId: p.id, number: 1, label: 'Legacy frozen fixture', ...source, manifest: source.manifest as unknown as Prisma.InputJsonValue, state: 'FROZEN', createdById: users[0] } });
      const data: ContestDataValue = { title: 'Contest sync rollback', author: '', stage: '', dateHeader: '', dateCover: '', language: 'zh-CN', templates: bindings, items: [{ problemId: p.id, revisionId: oldProblem.id, code: 'A', lectureOrder: 1 }] };
      let c = (await call('POST', '/contests', { expectedVersion: 0, data })).json(); contests.push(c.id);
      assert(!c.data.items[0].revisionId, 'new selections must not pin a source revision');
      // Simulate the exact JSON already stored by the previous application version.
      c = await tx.contest.update({ where: { id: c.id }, data: { data } });
      const frozen: FrozenContest = { schemaVersion: 1, selection: data, problems: [{ problemId: p.id, revisionId: oldProblem.id, revisionNumber: 1, hash: source.hash, judgeHash: source.judgeHash!, acceptanceRunId: source.acceptanceRunId!, manifest: source.manifest }], templates: Object.fromEntries(kinds.map(kind => { const t = templates.find(t => t.id === bindings[kind])!; return [kind, { id: t.id, number: t.number, hash: t.hash, files: t.files }]; })) };
      const legacy = await tx.contestRevision.create({ data: { contestId: c.id, number: 1, data: frozen as unknown as Prisma.InputJsonValue, hash: hashObject(frozen), createdById: users[0] } });
      const second = (await call('POST', '/contests', { expectedVersion: 0, data: { ...data, items: [{ problemId: p.id, code: 'C', lectureOrder: 2 }] } })).json(); contests.push(second.id);
      await tx.contestMember.createMany({ data: [{ contestId: c.id, userId: users[1], role: 'EDITOR' }, { contestId: c.id, userId: users[2], role: 'VIEWER' }] });
      let view = (await call('GET', `/contests/${c.id}`)).json(); assert.equal(view.revisions[0].current, true); assert(!view.data.items[0].revisionId);
      const finishBuilds = async (bundle: any) => {
        for (const build of bundle.builds) await tx.build.update({ where: { id: build.id }, data: { state: 'SUCCEEDED', log: 'Rollback-only metadata; TeX was NOT executed.', artifacts: { create: { key: `fixture/${build.id}`, hash: sha256('fixture'), bytes: 7, mediaType: 'application/pdf' } } } });
      };
      const original = (await call('POST', `/contests/${c.id}/builds`, { revisionId: legacy.id, kinds: ['STATEMENT'] })).json(); await finishBuilds(original);
      const oldInput = structuredClone(original.builds[0].input);
      assert.equal((await call('GET', `/builds/${original.builds[0].id}`)).json().stale, false);
      const oldExport = (await call('POST', `/contests/${c.id}/exports`, { revisionId: legacy.id, purpose: 'STATEMENT', format: 'NATIVE' })).json();
      const oldBytes = Buffer.from((await call('GET', `/exports/${oldExport.id}/file`)).rawPayload);

      await call('PUT', `/problems/${p.id}/meta`, { expectedVersion: 1, title: 'Latest problem title', tags: ['updated'], notes: 'Latest notes', responsibleId: users[0], archived: false });
      await saveDocument('STATEMENT', 'Latest statement.');
      await saveDocument('EDITORIAL_DOCUMENT', 'Latest editorial.');
      await saveDocument('EDITORIAL_BEAMER', '\\begin{frame}{Latest slides}Latest explanation.\\end{frame}');
      for (const id of contests) { view = (await call('GET', `/contests/${id}`)).json(); assert.equal(view.completeness.items[0].title, 'Latest problem title'); assert.equal(view.version, 1); }
      view = (await call('GET', `/contests/${c.id}`)).json(); assert.equal(view.revisions[0].current, false); assert.equal(view.completeness.items[0].acceptanceCurrent, true);
      assert.equal((await call('GET', `/contests/${c.id}/builds`)).json()[0].builds[0].stale, true);
      assert.equal((await call('GET', `/builds/${original.builds[0].id}`)).json().stale, true);
      await call('POST', `/contests/${c.id}/releases`, { buildId: original.builds[0].id }, 409);
      await call('POST', `/contests/${c.id}/releases`, { exportId: oldExport.id }, 409);
      assert.deepEqual((await call('GET', `/exports/${oldExport.id}/file`)).rawPayload, oldBytes);
      checks.push('legacy and new contests follow saved metadata and all three documents; all stale/release checks follow source hashes; old exports unchanged');

      await call('POST', `/contests/${c.id}/builds`, { kinds: ['STATEMENT'] }, 400);
      await call('POST', `/contests/${c.id}/builds`, { expectedVersion: 2, kinds: ['STATEMENT'] }, 409);
      await call('POST', `/contests/${c.id}/builds`, { expectedVersion: 1, kinds: ['STATEMENT'] }, 403, 2);
      await call('POST', `/contests/${c.id}/builds`, { expectedVersion: 1, kinds: ['STATEMENT'] }, 403, 0, false);
      await call('GET', `/contests/${c.id}`, undefined, 404, 3);
      await call('GET', `/problems/${p.id}`, undefined, 404, 1);
      await call('POST', '/contests', { expectedVersion: 0, data }, 404, 3);
      await call('POST', `/contests/${c.id}/freeze`, { expectedVersion: 1 }, 403, 1);
      const current = (await call('POST', `/contests/${c.id}/builds`, { expectedVersion: 1, kinds: [...kinds] }, 200, 1)).json(); await finishBuilds(current);
      assert.deepEqual(current.builds.map((b: any) => b.input.contest.entries[0].body), ['Latest statement.', 'Latest editorial.', '\\begin{frame}{Latest slides}Latest explanation.\\end{frame}']);
      const currentRevision = await tx.contestRevision.findUniqueOrThrow({ where: { id: current.builds[0].contestRevisionId } });
      assert.deepEqual((currentRevision.data as unknown as FrozenContest).problems[0].manifest, (await problemSnapshot(tx, p.id)).manifest);
      assert.equal((await call('POST', `/contests/${c.id}/freeze`, { expectedVersion: 1 })).json().id, currentRevision.id);
      assert.equal(await tx.problemRevision.count({ where: { problemId: p.id } }), 1, 'no implicit changes to source revisions');
      assert.deepEqual((await tx.build.findUniqueOrThrow({ where: { id: original.builds[0].id } })).input, oldInput);
      assert.deepEqual((await tx.contestRevision.findUniqueOrThrow({ where: { id: legacy.id } })).data, frozen);
      const latestExport = (await call('POST', `/contests/${c.id}/exports`, { expectedVersion: 1, purpose: 'STATEMENT', format: 'NATIVE' }, 200, 1)).json();
      assert.equal(latestExport.revisionId, currentRevision.id);
      const outer = await readArchive((await call('GET', `/exports/${latestExport.id}/file`)).rawPayload);
      const inside = await readArchive(outer.get('problems/A.zip')!);
      assert([...inside.values()].some(bytes => bytes.toString().includes('Latest statement.')));
      await call('POST', `/contests/${c.id}/releases`, { buildId: current.builds[0].id });
      await call('POST', `/contests/${c.id}/releases`, { exportId: latestExport.id });
      checks.push('default builds and packages capture latest input; repeated snapshots reused; editor can generate but cannot edit sources or manually freeze; permissions/CSRF/version conflicts enforced');

      await saveDocument('EDITORIAL_DOCUMENT', '', false);
      view = (await call('GET', `/contests/${c.id}`)).json(); assert.equal(view.completeness.items[0].materials.EDITORIAL_DOCUMENT, false);
      const missing = (await call('POST', `/contests/${c.id}/builds`, { expectedVersion: 1, kinds: ['EDITORIAL_DOCUMENT'] }, 422)).json(); assert.equal(missing.code, 'MISSING_MATERIAL');
      await call('PUT', `/problems/${p.id}/judge-settings`, { expectedVersion: 1, settings: { ...defaultJudgeSettings, timeLimitMs: 2300, memoryLimitMb: 384 } });
      const scheduledBefore = scheduled.length;
      await call('POST', `/contests/${c.id}/builds`, { expectedVersion: 1, kinds: ['STATEMENT'] }, 409);
      await call('POST', `/contests/${c.id}/freeze`, { expectedVersion: 1 }, 409);
      assert.equal(scheduled.length, scheduledBefore);
      test = (await call('PUT', `/tests/${test.id}`, { ...testData, expectedVersion: test.version, inputBase64: Buffer.from('3 4\n').toString('base64'), answerBase64: Buffer.from('7\n').toString('base64') })).json();
      await saveDocument('STATEMENT', 'Newest statement with updated sample.');
      const program = await tx.program.findFirstOrThrow({ where: { problemId: p.id, role: 'MAIN_SOLUTION' } });
      await call('PUT', `/programs/${program.id}`, { expectedVersion: program.version, name: 'Updated main solution', role: 'MAIN_SOLUTION', profileId: profile.id, source: '// Updated rollback-only source; never executed.', enabled: true, expectedVerdicts: ['AC'], notes: 'Updated program notes' });
      await accept();
      const final = (await call('POST', `/contests/${c.id}/builds`, { expectedVersion: 1, kinds: ['STATEMENT'] })).json(); await finishBuilds(final);
      const input = final.builds[0].input;
      assert.equal(input.contest.entries[0].timeLimitMs, 2300); assert.equal(input.contest.entries[0].memoryLimitMb, 384);
      assert.equal(input.samples[0].revisionId, test.currentRevisionId); assert.equal(input.samples[0].input.hash, sha256('3 4\n'));
      const finalSnapshot = (await tx.contestRevision.findUniqueOrThrow({ where: { id: final.builds[0].contestRevisionId } })).data as unknown as FrozenContest;
      assert.deepEqual(finalSnapshot.problems[0].manifest, (await problemSnapshot(tx, p.id)).manifest);
      assert.equal(finalSnapshot.problems[0].manifest.programs.find(s => s.id === program.id)!.source, '// Updated rollback-only source; never executed.');
      assert.deepEqual((await tx.build.findUniqueOrThrow({ where: { id: current.builds[0].id } })).input, current.builds[0].input);
      const draft = (await call('POST', '/problems', { title: 'Draft allowed', language: 'zh-CN' })).json(); fixtures.push(draft.id);
      const draftContest = (await call('POST', '/contests', { expectedVersion: 0, data: { ...data, items: [{ problemId: draft.id, code: 'D', lectureOrder: 1 }] } })).json(); contests.push(draftContest.id);
      await call('POST', `/contests/${draftContest.id}/builds`, { expectedVersion: 1, kinds: ['STATEMENT'] }, 409);
      await tx.problem.delete({ where: { id: draft.id } });
      assert.equal((await call('GET', `/contests/${draftContest.id}`)).json().completeness.items[0].title, '源题不存在');
      await call('POST', `/contests/${draftContest.id}/freeze`, { expectedVersion: 1 }, 409);
      await tx.contestMember.deleteMany({ where: { contestId: c.id, userId: users[1] } });
      await call('GET', `/contests/${c.id}`, undefined, 404, 1);
      await call('GET', `/exports/${latestExport.id}/file`, undefined, 404, 1);
      assert.deepEqual((await tx.contest.findUniqueOrThrow({ where: { id: c.id } })).data, data, 'synchronization never rewrites saved arrangement');
      checks.push('missing/disabled material and missing sources fail clearly; changed limits invalidate acceptance; reaccepted limits and rebound sample versions sync; source drafts can be arranged; revoked contest access denied');
      throw rollback;
    } finally { for (const item of saved.reverse()) item.object[item.method] = item.original; }
  }, { timeout: 60000 }).catch(error => { if (error !== rollback) throw error; });
  assert.equal(await db.user.count({ where: { id: { in: users } } }), 0);
  assert.equal(await db.problem.count({ where: { id: { in: fixtures } } }), 0);
  assert.equal(await db.contest.count({ where: { id: { in: contests } } }), 0);
  assert.equal(await db.build.count({ where: { requestedById: { in: users } } }), 0);
  assert.equal(await db.auditLog.count({ where: { actorId: { in: users } } }), 0);
  const report = { passed: true, rolledBack: true, realQueueJobs: 0, storage: 'in-memory', execution: 'No Judge or TeX; acceptance and completed builds are explicitly synthetic metadata.', checks };
  await mkdir('.local/contest-sync', { recursive: true });
  await writeFile('.local/contest-sync/verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { Queue.prototype.add = savedAdd; storage.put = savedPut; storage.get = savedGet; await app.close(); await db.$disconnect(); }
process.exit(0);
