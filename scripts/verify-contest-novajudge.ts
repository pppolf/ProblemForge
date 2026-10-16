import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { db, Prisma } from '@problemforge/database';
import { config, hashObject, sha256 } from '@problemforge/domain';
import { defaultJudgeSettings, type ContestDataValue } from '@problemforge/contracts';
import { readArchive } from '@problemforge/problem-format';
import { createApp, storage } from '../apps/api/src/app.ts';
import { problemSnapshot } from '../apps/api/src/modules/revision-snapshot.ts';

if (!process.argv.includes('--rollback')) throw new Error('请指定 --rollback；所有数据库夹具回滚，存储只用内存替身');
const rollback = new Error('ROLLBACK_CONTEST_NOVAJUDGE'), users = Array.from({ length: 4 }, () => randomUUID());
const tokens = users.map(() => randomUUID()), csrf = randomUUID(), problems: string[] = [], contests: string[] = [], checks: string[] = [];
const memory = new Map<string, Buffer>(), savedPut = storage.put, savedGet = storage.get;
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
        await tx.user.create({ data: { id, name: 'Contest package rollback', email: `${id}@example.test`, role: 'USER', passwordHash: 'not-a-login-credential' } });
        await tx.session.create({ data: { id: sha256(tokens[index]), userId: id, csrfToken: csrf, expiresAt: new Date(Date.now() + 180000) } });
      }
      const call = async (method: 'GET' | 'POST' | 'PUT', path: string, payload?: object, expected = 200, actor = 0, withCsrf = true) => {
        const response = await app.inject({ method, url: `/api${path}`, headers: { origin: config.origin, cookie: `pf_session=${tokens[actor]}`, ...(withCsrf ? { 'x-csrf-token': csrf } : {}) }, ...(payload ? { payload } : {}) });
        assert.equal(response.statusCode, expected, `${path}: ${response.body.slice(0, 1000)}`); return response;
      };
      const profile = await tx.compileProfile.findFirstOrThrow({ where: { enabled: true, language: 'CPP17' } });
      const hidden: any[] = [], statements: any[] = [], initial: any[] = [];
      const testBody = (number: number, answer = '3\r\n') => ({ number, groupName: 'main', isSample: number === 1, enabled: true, notes: '', inputBase64: Buffer.from(`${number} 2\r\n`).toString('base64'), answerBase64: Buffer.from(answer).toString('base64') });
      for (let i = 0; i < 3; i++) {
        const p = (await call('POST', '/problems', { title: '同名题目', language: 'zh-CN' })).json(); problems.push(p.id);
        const sample = (await call('POST', `/problems/${p.id}/tests`, testBody(1))).json();
        hidden.push((await call('POST', `/problems/${p.id}/tests`, testBody(2))).json());
        const statement = await tx.document.findFirstOrThrow({ where: { problemId: p.id, kind: 'STATEMENT', language: 'zh-CN' } });
        statements.push(statement);
        await call('PUT', `/documents/${statement.id}`, { expectedVersion: 1, enabled: true, body: String.raw`旧题面。\InputFile 输入。\OutputFile 输出。`, metadata: { title: '题面', author: '' }, templateVersionId: null, sampleRevisionIds: [sample.currentRevisionId] });
        if (i) {
          const role = i === 1 ? 'CHECKER' : 'INTERACTOR';
          await call('POST', `/problems/${p.id}/programs`, { name: role, role, profileId: profile.id, source: '// Fixed rollback fixture; never executed.', enabled: true, expectedVerdicts: ['AC'], notes: '' });
          await call('PUT', `/problems/${p.id}/judge-settings`, { expectedVersion: 1, settings: { ...defaultJudgeSettings, ...(i === 1 ? { checkerMode: 'CUSTOM' } : { interactionMode: 'INTERACTIVE' }) } });
        }
        initial.push(await problemSnapshot(tx, p.id));
      }
      const data: ContestDataValue = { title: '比赛题包回滚验证', author: '', stage: '', dateHeader: '', dateCover: '', language: 'zh-CN', templates: { STATEMENT: null, EDITORIAL_DOCUMENT: null, EDITORIAL_BEAMER: null }, items: problems.map((problemId, i) => ({ problemId, code: ['C', 'A', 'B'][i], lectureOrder: 3 - i })) };
      const contest = (await call('POST', '/contests', { expectedVersion: 0, data })).json(); contests.push(contest.id);
      for (const [i, role] of [[1, 'EDITOR'], [2, 'VIEWER']] as const) await tx.contestMember.create({ data: { contestId: contest.id, userId: users[i], role } });
      const url = `/contests/${contest.id}/novajudge-exports`;
      const unpack = async (artifact: any, actor = 0) => {
        const response = await call('GET', `/exports/${artifact.id}/file`, undefined, 200, actor);
        assert.equal(sha256(response.rawPayload), artifact.hash);
        assert.equal(decodeURIComponent(String(response.headers['content-disposition']).split("filename*=UTF-8''")[1]), artifact.fileName);
        return readArchive(response.rawPayload, { unicodePaths: true });
      };
      const current = (await call('POST', url, { expectedVersion: 1 }, 200, 1)).json();
      assert.equal(current.format, 'NOVAJUDGE_CONTEST'); assert.match(current.revisionId, /^WORKING:[a-f0-9]{64}$/);
      assert.equal(current.fileName, 'contest_比赛题包回滚验证_NovaJudge.zip');
      const files = await unpack(current), roots = ['001_C_同名题目', '002_A_同名题目', '003_B_同名题目'];
      assert.deepEqual([...new Set([...files.keys()].map(path => path.split('/')[0]))], roots);
      for (let i = 0; i < 3; i++) {
        const json = JSON.parse(files.get(`${roots[i]}/problem.json`)!.toString());
        assert.equal(json.id, i + 1); assert.equal(json.type, ['default', 'spj', 'interactive'][i]);
        assert.deepEqual(json.samples, [{ input: '1 2\r\n', output: '3\r\n' }]);
        assert.equal(files.get(`${roots[i]}/data/2.in`)!.toString(), '2 2\r\n');
      }
      assert(!files.has(`${roots[2]}/data/2.ans`)); assert(files.has(`${roots[1]}/data/checker.cpp`)); assert(files.has(`${roots[2]}/data/interactor.cpp`));
      assert.equal(await tx.contestRevision.count({ where: { contestId: contest.id } }), 0);
      assert.equal(await tx.testRun.count({ where: { problemId: { in: problems } } }), 0);
      assert.equal(await tx.release.count({ where: { contestId: contest.id } }), 0);
      for (let i = 0; i < 3; i++) assert.deepEqual((await problemSnapshot(tx, problems[i])).manifest, initial[i].manifest);
      assert((await call('GET', `/contests/${contest.id}/exports`)).json().some((e: any) => e.id === current.id));
      checks.push('three problem types in one ZIP; contest order, same titles, raw data and samples; no freeze, template or acceptance requirement; immutable private download');

      // Historical snapshot fixture only; no acceptance or author execution is claimed.
      const frozen = { schemaVersion: 1, selection: data, templates: {}, problems: initial.map((s, i) => ({ problemId: problems[i], revisionId: `WORKING:${s.hash}`, revisionNumber: null, hash: s.hash, judgeHash: '', acceptanceRunId: '', manifest: s.manifest })) };
      const revision = await tx.contestRevision.create({ data: { contestId: contest.id, number: 1, data: frozen as unknown as Prisma.InputJsonValue, hash: hashObject(frozen), createdById: users[0] } });
      await call('PUT', `/documents/${statements[0].id}`, { expectedVersion: 2, enabled: true, body: '新题面。', metadata: { title: '题面', author: '' }, templateVersionId: null, sampleRevisionIds: [] });
      const latest = (await call('POST', url, { expectedVersion: 1, comparison: 'PRESERVE' })).json();
      const latestFiles = await unpack(latest);
      assert.match(latestFiles.get(`${roots[0]}/problem.json`)!.toString(), /新题面/);
      assert.equal(JSON.parse(latestFiles.get(`${roots[0]}/problem.json`)!.toString()).type, 'spj');
      const fixed = (await call('POST', url, { revisionId: revision.id }, 200, 2)).json();
      assert.equal(fixed.revisionId, revision.id);
      assert.deepEqual(await unpack(fixed, 2), files);
      assert.deepEqual(await unpack(current), files);
      await call('PUT', `/contests/${contest.id}`, { expectedVersion: 1, data: { ...data, language: 'en', items: [...data.items].reverse() } });
      await call('POST', url, { expectedVersion: 1 }, 409);
      const missingLanguage = await call('POST', url, { expectedVersion: 2 }, 422);
      assert.match(missingLanguage.body, /题号 B.*en/);
      assert.deepEqual(await unpack((await call('POST', url, { revisionId: revision.id })).json()), files);
      checks.push('current content refresh and comparison option; historical language/order/data remain fixed after edits; stale arrangement rejected');

      await call('POST', url, {}, 400);
      await call('POST', url, { expectedVersion: 2, comparison: 'UNKNOWN' }, 400);
      await call('POST', url, { expectedVersion: 2 }, 403, 0, false);
      await call('POST', url, { expectedVersion: 2 }, 403, 2);
      await call('POST', url, { expectedVersion: 2 }, 404, 3);
      await call('GET', `/exports/${current.id}/file`, undefined, 404, 3);
      await call('POST', `/contests/${contest.id}/releases`, { exportId: current.id }, 404);
      const other = (await call('POST', '/contests', { expectedVersion: 0, data: { ...data, items: [] } })).json(); contests.push(other.id);
      await call('POST', `/contests/${other.id}/novajudge-exports`, { expectedVersion: 1 }, 422);
      await call('POST', `/contests/${other.id}/novajudge-exports`, { revisionId: revision.id }, 404);
      await tx.contestMember.delete({ where: { contestId_userId: { contestId: contest.id, userId: users[2] } } });
      await call('GET', `/exports/${fixed.id}/file`, undefined, 404, 2);
      await call('POST', url, { revisionId: revision.id }, 404, 2);
      checks.push('CSRF, version/schema, editor/viewer/outsider, cross-contest revision and revoked download permissions; no public release');

      await call('PUT', `/contests/${contest.id}`, { expectedVersion: 2, data });
      await call('PUT', `/tests/${hidden[0].id}`, { ...testBody(2), answerBase64: null, expectedVersion: 1 });
      const exportCount = await tx.exportArtifact.count({ where: { contestId: contest.id } }), writes = memory.size;
      const missingAnswer = await call('POST', url, { expectedVersion: 3 }, 422);
      assert.match(missingAnswer.body, /题号 C.*缺少答案/);
      assert.equal(await tx.exportArtifact.count({ where: { contestId: contest.id } }), exportCount); assert.equal(memory.size, writes);
      await tx.contestRevision.update({ where: { id: revision.id }, data: { hash: '0'.repeat(64) } });
      await call('POST', url, { revisionId: revision.id }, 409);
      checks.push('missing answer reports affected code without a partial archive; corrupt historical snapshot rejected');
      throw rollback;
    } finally { for (const item of saved.reverse()) item.object[item.method] = item.original; }
  }, { timeout: 60000 }).catch(error => { if (error !== rollback) throw error; });
  assert.equal(await db.user.count({ where: { id: { in: users } } }), 0);
  assert.equal(await db.problem.count({ where: { id: { in: problems } } }), 0);
  assert.equal(await db.contest.count({ where: { id: { in: contests } } }), 0);
  assert.equal(await db.exportArtifact.count({ where: { requestedById: { in: users } } }), 0);
  assert.equal(await db.auditLog.count({ where: { actorId: { in: users } } }), 0);
  await mkdir('.local/contest-novajudge', { recursive: true });
  const result = { passed: true, rolledBack: true, checks, listeners: 0, persistentFiles: 0, authorExecution: false };
  await writeFile('.local/contest-novajudge/api-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { storage.put = savedPut; storage.get = savedGet; await app.close(); await db.$disconnect(); }
process.exit(0);
