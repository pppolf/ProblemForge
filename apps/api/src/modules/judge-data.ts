import { db, Prisma } from '@problemforge/database';
import { HttpError, sha256 } from '@problemforge/domain';
import { MAX_TEST_BYTES, type TestCaseSave } from '@problemforge/contracts';
import type { BlobRef } from '@problemforge/judge-core';
import { storage } from '../app.ts';

export { MAX_TEST_BYTES } from '@problemforge/contracts';
export function rawBytes(base64: string, maxBytes = MAX_TEST_BYTES) {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > maxBytes || bytes.toString('base64') !== base64) throw new HttpError(422, `数据必须为规范 Base64，最大 ${maxBytes} 字节；不会 trim 或转换换行`);
  return bytes;
}
export async function saveBlob(problemId: string, bytes: Buffer): Promise<BlobRef> {
  const hash = sha256(bytes), key = `tests/${problemId}/${hash}.bin`;
  await storage.put(key, bytes); return { key, hash, bytes: bytes.length };
}
export async function lockProblem(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${id} FOR UPDATE`;
}
export async function touchProblem(tx: Prisma.TransactionClient, id: string) { await tx.problem.update({ where: { id }, data: { updatedAt: new Date() } }); }
export async function appendTest(tx: Prisma.TransactionClient, problemId: string, data: Omit<TestCaseSave, 'inputBase64' | 'answerBase64'>, input: BlobRef, answer: BlobRef | null, provenance: Prisma.InputJsonValue, existing?: { id: string; version: number }) {
  if (input.bytes > MAX_TEST_BYTES || (answer?.bytes ?? 0) > MAX_TEST_BYTES) throw new HttpError(422, `单份输入或答案最大 ${MAX_TEST_BYTES / 1_000_000} MB`);
  let testId: string, version: number;
  if (existing) {
    const updated = await tx.testCase.updateMany({ where: { id: existing.id, problemId, deletedAt: null, version: existing.version }, data: { number: data.number, groupName: data.groupName, isSample: data.isSample, enabled: data.enabled, notes: data.notes, version: { increment: 1 } } });
    if (!updated.count) throw new HttpError(409, '测试数据版本冲突，本地内容未被覆盖', 'VERSION_CONFLICT');
    testId = existing.id; version = existing.version + 1;
  } else {
    if (await tx.testCase.count({ where: { problemId, deletedAt: null } }) >= 500) throw new HttpError(422, '本题最多保存 500 组测试数据');
    const created = await tx.testCase.create({ data: { problemId, ...data } });
    testId = created.id; version = 1;
  }
  const revision = await tx.testCaseRevision.create({ data: {
    testCaseId: testId, version, inputKey: input.key, inputHash: input.hash, inputBytes: input.bytes,
    answerKey: answer?.key, answerHash: answer?.hash, answerBytes: answer?.bytes,
    provenance, configuration: data,
  } });
  await tx.testCase.update({ where: { id: testId }, data: { currentRevisionId: revision.id } });
  await touchProblem(tx, problemId);
  return testId;
}
export async function publicTest(id: string) {
  const test = await db.testCase.findUniqueOrThrow({ where: { id }, include: { currentRevision: true } });
  const { inputKey: _inputKey, answerKey: _answerKey, ...revision } = test.currentRevision!;
  return { ...test, currentRevision: revision };
}
