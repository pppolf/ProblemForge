import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, type Prisma } from '@problemforge/database';
import { HttpError, hashObject, problemAccess } from '@problemforge/domain';
import { appendTest, lockProblem } from '../apps/api/src/modules/judge-data.ts';
import { deleteTestCases } from '../apps/api/src/modules/test-deletion.ts';
import { judgeSnapshot, dependencyHash } from '../apps/api/src/modules/judge-snapshot.ts';
import { problemSnapshot } from '../apps/api/src/modules/revision-snapshot.ts';
import { restoreManifest } from '../apps/api/src/modules/restore-manifest.ts';
import { validateGroups } from '../apps/api/src/modules/test-groups.ts';

// No listener, queue jobs or storage writes. All fixture rows are uncommitted,
// scoped to fresh IDs and rolled back, even when an assertion fails.
if (!process.argv.includes('--rollback')) throw new Error('请显式传入 --rollback；此检查只使用必定回滚的事务');
const fixtureIds = [randomUUID(), randomUUID()];
const rollback = new Error('ROLLBACK_VERIFICATION');
const status = (code: number) => (error: unknown) => error instanceof HttpError && error.statusCode === code;
const evidence: string[] = [];
try {
  await db.$transaction(async tx => {
    const problemId = fixtureIds[0], actorId = 'rollback-verification';
    await tx.problem.createMany({ data: fixtureIds.map(id => ({ id, title: 'Uncommitted deletion verification' })) });
    await lockProblem(tx, problemId);
    const data = { number: 1, groupName: 'main', isSample: true, enabled: true, notes: '' };
    const blob = { key: 'verification-only/not-written.bin', hash: 'a'.repeat(64), bytes: 2 };
    const ids: string[] = [];
    for (const number of [1, 2, 3]) ids.push(await appendTest(tx, problemId, { ...data, number }, blob, blob, { verification: true }));
    const otherId = await appendTest(tx, fixtureIds[1], data, blob, blob, { verification: true });
    const tests = await tx.testCase.findMany({ where: { problemId }, include: { currentRevision: true }, orderBy: { number: 'asc' } });
    const groups = { groups: [{ id: 'main', points: 100, aggregation: 'ALL' as const, members: tests.map(test => ({ testId: test.id, revisionId: test.currentRevisionId!, weight: 1 })), dependencies: [], extraValidatorIds: [] }] };
    await tx.testGroupConfig.create({ data: { problemId, version: 1, data: groups, hash: hashObject(groups) } });
    const doc = await tx.document.create({ data: { problemId, language: 'zh-CN', kind: 'STATEMENT' } });
    const sampleIds = [tests[0].currentRevisionId!];
    const content = await tx.contentRevision.create({ data: { documentId: doc.id, version: 1, body: '', metadata: {}, sampleRevisionIds: sampleIds, hash: hashObject(sampleIds) } });
    await tx.document.update({ where: { id: doc.id }, data: { currentRevisionId: content.id } });
    const initialJudge = await judgeSnapshot(tx, problemId, 'VALIDATE');
    const initial = await problemSnapshot(tx, problemId);
    const frozen = await tx.problemRevision.create({ data: { problemId, number: 1, label: 'Uncommitted metadata fixture', state: 'FROZEN', createdById: actorId, ...initial, manifest: initial.manifest as unknown as Prisma.InputJsonValue } });
    const select = (id: string, expectedVersion = 1) => ({ id, expectedVersion });
    await assert.rejects(deleteTestCases(tx, problemId, [select(ids[0]), select(ids[1], 2)], actorId), status(409));
    await assert.rejects(deleteTestCases(tx, problemId, [select(ids[0]), select(otherId)], actorId), status(409));
    await assert.rejects(deleteTestCases(tx, problemId, [select(ids[0]), select(ids[0])], actorId), status(422));
    assert.equal(await tx.testCase.count({ where: { problemId, deletedAt: null } }), 3);
    assert.equal(await tx.auditLog.count({ where: { resourceId: problemId } }), 0);
    evidence.push('stale, mixed-problem and repeated selections reject the entire batch');

    const result = await deleteTestCases(tx, problemId, [select(ids[0])], actorId);
    assert.deepEqual(result, { deletedIds: [ids[0]], affectedGroups: ['main'] });
    const deleted = await tx.testCase.findUniqueOrThrow({ where: { id: ids[0] } });
    assert.ok(deleted.deletedAt); assert.equal(deleted.version, 2);
    assert.deepEqual(await tx.testCaseRevision.findUnique({ where: { id: sampleIds[0] } }), tests[0].currentRevision);
    assert.deepEqual((await tx.contentRevision.findUniqueOrThrow({ where: { id: content.id } })).sampleRevisionIds, sampleIds);
    assert.deepEqual(await tx.problemRevision.findUnique({ where: { id: frozen.id } }), frozen);
    const current = await problemSnapshot(tx, problemId);
    assert.equal(current.manifest.tests.length, 2);
    assert.deepEqual(current.manifest.samples, initial.manifest.samples);
    assert.notEqual(current.hash, initial.hash);
    assert.notEqual(dependencyHash(await judgeSnapshot(tx, problemId, 'VALIDATE')), dependencyHash(initialJudge));
    await assert.rejects(appendTest(tx, problemId, data, blob, blob, {}, { id: ids[0], version: 2 }), status(409));
    await assert.rejects(validateGroups(tx, problemId, groups), status(422));
    evidence.push('deletion preserves sample/frozen history, invalidates current dependencies and rejects editing a tombstone');

    const replacement = await appendTest(tx, problemId, data, blob, blob, { regenerated: true });
    assert.notEqual(replacement, ids[0]);
    // A constraint violation aborts a Postgres transaction until its savepoint is restored.
    await tx.$executeRawUnsafe('SAVEPOINT duplicate_number');
    try { await assert.rejects(appendTest(tx, problemId, data, blob, blob, {}), (error: any) => error.code === 'P2002'); }
    finally { await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_number'); await tx.$executeRawUnsafe('RELEASE SAVEPOINT duplicate_number'); }
    const live = await judgeSnapshot(tx, problemId, 'VALIDATE');
    assert.ok(live.tests.some(test => test.id === replacement));
    assert.ok(!live.tests.some(test => test.id === ids[0]));
    assert.deepEqual((await deleteTestCases(tx, problemId, ids.slice(1).map(id => select(id)), actorId)).deletedIds, ids.slice(1));
    await assert.rejects(deleteTestCases(tx, problemId, [select(replacement), select(ids[1])], actorId), status(409));
    assert.equal(await tx.testCase.count({ where: { problemId, deletedAt: null } }), 1);
    assert.equal(await tx.auditLog.count({ where: { resourceId: problemId, action: 'DELETE_TESTS' } }), 2);
    evidence.push('single/batch deletion, number reuse, active-number uniqueness and transactional audit');

    await restoreManifest(tx, problemId, initial.manifest, false);
    const restored = await problemSnapshot(tx, problemId);
    assert.deepEqual(restored.manifest.tests.filter(test => test.enabled).map(test => test.number), [1, 2, 3]);
    assert.ok(await tx.testCase.count({ where: { problemId, deletedAt: { not: null } } }) === 3);
    await validateGroups(tx, problemId, restored.manifest.groups!);
    assert.deepEqual(await tx.problemRevision.findUnique({ where: { id: frozen.id } }), frozen);
    evidence.push('explicit frozen-revision restore remaps live data and groups while retaining deleted history');
    throw rollback;
  }, { timeout: 20000 }).catch(error => { if (error !== rollback) throw error; });
  assert.equal(await db.problem.count({ where: { id: { in: fixtureIds } } }), 0);
  assert.equal(await db.auditLog.count({ where: { resourceId: { in: fixtureIds } } }), 0);

  // Exercise the shared write gate using read-only permission fixtures.
  let role: string | null = 'OWNER', archived = false;
  const readers = [
    { model: db.problem, key: 'findUnique', read: async () => ({ id: fixtureIds[0], archived }) },
    { model: db.problemMember, key: 'findUnique', read: async () => role ? { role, languages: [] } : null },
    { model: db.problemGroupMember, key: 'findMany', read: async () => [] },
  ].map(reader => ({ ...reader, original: (reader.model as any)[reader.key] }));
  for (const reader of readers) (reader.model as any)[reader.key] = reader.read;
  try {
    for (const value of ['OWNER', 'EDITOR']) { role = value; assert.equal(await problemAccess({ id: 'fixture', role: 'USER' }, fixtureIds[0], true), value); }
    for (const value of ['VIEWER', 'REVIEWER', 'TRANSLATOR']) { role = value; await assert.rejects(problemAccess({ id: 'fixture', role: 'USER' }, fixtureIds[0], true), status(403)); }
    role = null; await assert.rejects(problemAccess({ id: 'fixture', role: 'USER' }, fixtureIds[0], true), status(404));
    role = 'OWNER'; archived = true; await assert.rejects(problemAccess({ id: 'fixture', role: 'USER' }, fixtureIds[0], true), status(409));
  } finally { for (const reader of readers) (reader.model as any)[reader.key] = reader.original; }
  evidence.push('shared write permission gate rejects viewers/reviewers/translators, nonmembers and archived problems');
  console.log(JSON.stringify({ passed: true, rolledBack: true, evidence }, null, 2));
} finally { await db.$disconnect(); }
// API modules also own idle BullMQ connections; this standalone check never
// submits jobs and may exit after its transaction and assertions have finished.
process.exit(0);
