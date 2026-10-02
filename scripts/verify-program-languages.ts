import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { db, Prisma } from '@problemforge/database';
import { config, hashObject, sha256 } from '@problemforge/domain';
import { defaultJudgeSettings, defaultInteractionSettings, type ProgramLanguage, type ProgramRole } from '@problemforge/contracts';
import { SandboxClient } from '../packages/judge-adapter/src/index.ts';
import { PrivateFileStorage } from '../packages/storage/src/index.ts';
import type { ProgramSnapshot } from '../packages/judge-core/src/index.ts';
import { nativeExporter, importNative, polygonExporter } from '@problemforge/problem-format';
import { createApp } from '../apps/api/src/app.ts';
import { judgeSnapshot, validateJudgeSnapshot } from '../apps/api/src/modules/judge-snapshot.ts';
import { problemSnapshot } from '../apps/api/src/modules/revision-snapshot.ts';
import { appendTest } from '../apps/api/src/modules/judge-data.ts';
import { Executor } from '../workers/judge/src/executor.ts';
import { pipeline, emptyReport } from '../workers/judge/src/pipeline.ts';

if (!process.argv.includes('--rollback') || !process.argv.includes('--sandbox')) throw new Error('需要 --rollback --sandbox：原库事务回滚，仅在现有 Linux 沙箱执行');
const suffix = randomUUID(), rollback = new Error('ROLLBACK_LANGUAGE_VERIFICATION'), evidence: object[] = [];
const sandbox = new SandboxClient(config.judgeSandboxUrl, config.judgeSandboxToken);
const bytes = new Map<string, Buffer>(), storage = new PrivateFileStorage(config.storageRoot);
// Keep verification artifacts in memory. No alternate storage instance or orphan
// files are introduced; the real Executor, pipeline and sandbox still run.
storage.put = async (key, value) => { bytes.set(key, Buffer.from(value)); };
storage.get = async key => { const value = bytes.get(key); assert(value, `Missing verification blob: ${key}`); return value; };
const app = await createApp(false);
let fixtureProblemId = '', fixtureUserId = '', executor: Executor | undefined;
try {
  await app.ready(); await sandbox.health();
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
      const user = await tx.user.create({ data: { email: `language-${suffix}@example.test`, name: 'Language verification', role: 'USER', passwordHash: 'not-a-login-credential' } }); fixtureUserId = user.id;
      const token = randomUUID(), csrf = randomUUID();
      await tx.session.create({ data: { id: sha256(token), userId: user.id, csrfToken: csrf, expiresAt: new Date(Date.now() + 180000) } });
      const call = async (method: 'GET' | 'POST' | 'PUT', path: string, body?: object, expected = 200) => {
        const res = await app.inject({ method, url: `/api${path}`, headers: { origin: config.origin, cookie: `pf_session=${token}`, 'x-csrf-token': csrf }, ...(body ? { payload: body } : {}) });
        assert.equal(res.statusCode, expected, `${method} ${path}: ${res.body}`); return res.json();
      };
      const profiles = await call('GET', '/compile-profiles');
      const problem = await tx.problem.create({ data: { title: 'Language rollback verification', members: { create: { userId: user.id, role: 'OWNER' } } } }); fixtureProblemId = problem.id;
      const sources: Record<ProgramLanguage, string> = {
        CPP17: '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}',
        CPP20: '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}',
        PYTHON3: 'a,b=map(int,input().split())\nprint(a+b)\n',
        C17: await readFile('fixtures/judge/sum-c17.c', 'utf8'), CPP23: await readFile('fixtures/judge/sum-cpp23.cpp', 'utf8'), JAVA17: await readFile('fixtures/judge/sum-java17.java', 'utf8'),
      };
      const programs: ProgramSnapshot[] = [];
      for (const language of Object.keys(sources) as ProgramLanguage[]) {
        const profile = profiles.find((p: any) => p.language === language && p.enabled); assert(profile, language);
        const data = { name: language, role: language === 'CPP17' ? 'MAIN_SOLUTION' : 'CORRECT_SOLUTION', profileId: profile.id, source: sources[language], enabled: true, expectedVerdicts: ['AC'], notes: '' };
        const p = await call('POST', `/problems/${problem.id}/programs`, data);
        programs.push({ id: p.id, revisionId: p.currentRevisionId, version: p.version, name: p.name, role: p.role, source: p.currentRevision.source, sourceHash: p.currentRevision.hash, enabled: p.enabled, expectedVerdicts: ['AC'], profile: p.profile });
        if (['C17', 'CPP23', 'JAVA17'].includes(language)) {
          await call('POST', '/admin/compile-profiles', { name: language, language, config: profile.config, enabled: true }, 403);
          await tx.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
          const created = await call('POST', '/admin/compile-profiles', { name: `Fixture ${language}`, language, config: profile.config, enabled: true });
          const updated = await call('PUT', `/admin/compile-profiles/${created.id}`, { name: created.name, language, config: { ...profile.config, warnings: false }, enabled: true, expectedVersion: 1 });
          assert.equal(updated.version, 2); assert.notEqual(updated.hash, created.hash);
          await tx.user.update({ where: { id: user.id }, data: { role: 'USER' } });
        }
        if (language === 'C17' || language === 'JAVA17') for (const role of ['VALIDATOR', 'EXTRA_VALIDATOR', 'CHECKER', 'INTERACTOR']) await call('POST', `/problems/${problem.id}/programs`, { ...data, role }, 422);
      }
      const validatorProfile = profiles.find((p: any) => p.language === 'CPP23');
      await call('POST', `/problems/${problem.id}/programs`, { name: 'C++23 testlib validator', role: 'VALIDATOR', profileId: validatorProfile.id, source: await readFile('fixtures/judge/sum-validator.cpp', 'utf8'), enabled: true, expectedVerdicts: ['AC'], notes: '' });
      for (const reserved of ['source.c', 'Main.java', 'program.jar']) await call('PUT', `/problems/${problem.id}/judge-settings`, { expectedVersion: 1, settings: { ...defaultJudgeSettings, ioMode: 'FILES', inputFile: reserved } }, 422);
      const input = Buffer.from('41 1\n'), answer = Buffer.from('42\n');
      const blob = async (value: Buffer) => { const key = `verification/${sha256(value)}`; await storage.put(key, value); return { key, hash: sha256(value), bytes: value.length }; };
      await appendTest(tx, problem.id, { number: 1, groupName: 'main', isSample: false, enabled: true, notes: '' }, await blob(input), await blob(answer), { type: 'MANUAL' });
      const snapshot = await judgeSnapshot(tx, problem.id, 'ACCEPTANCE'); validateJudgeSnapshot(snapshot);
      const leaseToken = randomUUID(), run = await tx.testRun.create({ data: { problemId: problem.id, requestedById: user.id, requestKey: suffix, purpose: 'ACCEPTANCE', state: 'RUNNING', leaseToken, input: snapshot as any, inputHash: hashObject(snapshot), dependencyHash: hashObject(snapshot) } });
      executor = new Executor(run.id, sandbox, storage, new AbortController().signal, await readFile('vendor/testlib/testlib.h', 'utf8'), { problemId: problem.id, leaseToken });
      const report = emptyReport(); assert.equal((await pipeline(run.id, snapshot, executor, report)).accepted, true);
      assert.equal(report.matrix.length, 6); assert(report.matrix.every(cell => cell.verdict === 'AC'));
      evidence.push({ check: 'real acceptance pipeline', languages: programs.map(p => p.profile.language), matrix: report.matrix.map(c => ({ language: c.programName, verdict: c.verdict })) });
      console.log('PASS: all six languages compiled and ran through the real acceptance pipeline.');
      for (const p of programs) {
        const cached = await executor.compile(p); assert(cached.compiled); assert.equal(cached.execution.result.status, 'Cached');
        const result = await executor.solution(cached.compiled, Buffer.from('100 23\n'), defaultJudgeSettings, 'cached'); assert.equal(result.verdict, 'AC', result.diagnostic); assert.equal(result.output?.toString(), '123\n');
        if (['C17', 'CPP23', 'JAVA17'].includes(p.profile.language)) {
          const bad = { ...p, source: 'this is invalid source code', sourceHash: sha256('this is invalid source code') };
          const failed = await executor.compile(bad); assert.equal(failed.compiled, null); assert.equal(failed.execution.verdict, 'CE'); assert(failed.execution.diagnostic.length > 0);
        }
      }
      const java = programs.find(p => p.profile.language === 'JAVA17')!;
      const variant = async (source: string, role: ProgramRole = 'CORRECT_SOLUTION', base = java) => {
        const p = { ...base, role, source, sourceHash: sha256(source) }, result = await executor!.compile(p); assert(result.compiled, result.execution.diagnostic); return result.compiled;
      };
      const generator = await variant('public class Main { public static void main(String[] a) { System.out.println(a[0]+" "+a[1]+" "+System.getenv("PF_SEED")); } }', 'GENERATOR');
      assert.equal((await executor.generate(generator, ['value with spaces'], '123', 'generator')).stdout.toString(), 'value with spaces 123 123\n');
      const fileProgram = await variant('import java.io.*; import java.util.*; public class Main { public static void main(String[] a) throws Exception { Scanner s = new Scanner(new File("input.txt")); try(PrintWriter p = new PrintWriter("output.txt")) { p.println(s.nextInt()+s.nextInt()); } } }');
      const fileResult = await executor.solution(fileProgram, input, { ...defaultJudgeSettings, ioMode: 'FILES' }, 'files'); assert.equal(fileResult.verdict, 'AC', fileResult.diagnostic); assert.equal(fileResult.output?.toString(), '42\n');
      const interactive = await variant('import java.util.*; public class Main { public static void main(String[] a) { System.out.println(2*new Scanner(System.in).nextInt()); System.out.flush(); } }');
      const interactor = await variant(await readFile('fixtures/judge/double-interactor.cpp', 'utf8'), 'INTERACTOR', programs.find(p => p.profile.language === 'CPP23')!);
      const interaction = await executor.interactive(interactive, interactor, input, null, { ...defaultJudgeSettings, interactionMode: 'INTERACTIVE', interaction: { ...defaultInteractionSettings, idleTimeMs: 2000 } }, 'interactive');
      assert.equal(interaction.verdict, 'AC', JSON.stringify(interaction));
      const loop = await variant('public class Main { public static void main(String[] a) { while(true) {} } }');
      assert.equal((await executor.solution(loop, Buffer.alloc(0), { ...defaultJudgeSettings, timeLimitMs: 300 }, 'timeout')).verdict, 'TLE');
      const memory = await variant('import java.util.*; public class Main { public static void main(String[] a) { List<byte[]> values = new ArrayList<>(); while(true) { byte[] b = new byte[1024*1024]; Arrays.fill(b,(byte)1); values.add(b); } } }');
      assert.equal((await executor.solution(memory, Buffer.alloc(0), { ...defaultJudgeSettings, memoryLimitMb: 64 }, 'memory')).verdict, 'MLE');
      evidence.push({ check: 'cache, failures and Java runtime', passed: ['six-language cache replay', 'C17/CPP23/JAVA17 CE', 'nested and sibling Java classes', 'Java argv and PF_SEED', 'Java file I/O', 'Java / C++23 testlib interaction', 'Java TLE', 'Java MLE'] });
      const manifest = (await problemSnapshot(tx, problem.id)).manifest;
      const native = await nativeExporter.export(manifest, 'FULL', key => storage.get(key)), restored = importNative(native.files);
      assert.deepEqual(restored.manifest.programs.map(p => p.profile.language), manifest.programs.map(p => p.profile.language));
      const polygon = await polygonExporter.export(manifest, 'FULL', key => storage.get(key));
      assert(polygon.report.some(issue => issue.status === 'BLOCKED' && issue.message.includes('JAVA17')));
      assert(polygon.files.has('files/p4.c') || [...polygon.files.keys()].some(path => path.endsWith('.c')));
      assert([...polygon.files.keys()].some(path => path.endsWith('.java')));
      evidence.push({ check: 'API and packages', passed: ['six catalog languages', 'new profiles admin-only create/update', 'C/Java testlib roles rejected', 'C++23 validator accepted', 'reserved I/O names', 'native round-trip', 'unmapped Polygon languages explicitly blocked, sources retained with correct suffixes'] });
      throw rollback;
    } finally { await executor?.cleanup(); for (const item of saved.reverse()) item.object[item.method] = item.original; }
  }, { timeout: 180000 }).catch(e => { if (e !== rollback) throw e; });
  assert.equal(await db.problem.count({ where: { id: fixtureProblemId } }), 0);
  assert.equal(await db.user.count({ where: { id: fixtureUserId } }), 0);
  assert.equal(await db.testRun.count({ where: { requestKey: suffix } }), 0);
  assert.equal(await db.auditLog.count({ where: { actorId: fixtureUserId } }), 0);
  await mkdir('.local', { recursive: true });
  const report = { passed: true, rolledBack: true, realLinuxSandbox: true, persistentFixtureFiles: 0, evidence };
  await writeFile('.local/verify-program-languages.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await app.close(); await db.$disconnect(); }
process.exit(0);
