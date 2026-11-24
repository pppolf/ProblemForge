import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defaultJudgeSettings,
  defaultCommunicationSettings,
  isJudgingData,
  type ProblemManifest,
} from '@problemforge/contracts';
import {
  digest,
  exportHydroProblem,
  exportNovaJudgeProblem,
  importNative,
  nativeExporter,
  validateManifest,
} from '@problemforge/problem-format';
import { render, TEX_PROFILE } from '@problemforge/template-engine';

const root = process.cwd();

const INTERACTOR_SRC = `#include "testlib.h"
#include <iostream>
using namespace std;
int main(int argc, char* argv[]) {
    registerInteraction(argc, argv);
    long long a = inf.readLong(0LL, 1000000000LL, "a");
    long long b = inf.readLong(0LL, 1000000000LL, "b");
    cout << "first\\n" << a << endl;
    long long msg = ouf.readLong(0LL, 1000000000LL, "message");
    if (!ouf.seekEof()) quitf(_pe, "Expected one integer");
    tout << "second\\n" << msg << ' ' << b << '\\n';
    tout.flush();
    quitf(_ok, "Forwarded");
}
`;

const CHECKER_SRC = `#include "testlib.h"
int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);
    long long a = inf.readLong(0LL, 1000000000LL, "a");
    long long b = inf.readLong(0LL, 1000000000LL, "b");
    long long found = ouf.readLong(0LL, 2000000000LL, "sum");
    if (!ouf.seekEof()) quitf(_pe, "Expected one integer");
    if (found != a + b) quitf(_wa, "Wrong sum");
    quitf(_ok, "OK");
}
`;

function makeCommunicationManifest(checkerMode: 'CUSTOM' | 'TOKENS' = 'CUSTOM') {
  const blobs = new Map<string, Buffer>();
  const store = (key: string, text: string) => {
    const buf = Buffer.from(text, 'utf8');
    blobs.set(key, buf);
    return { key, hash: digest(buf), bytes: buf.length };
  };

  const sampleIn = store('sample/1.in', 'first\n7\n');
  const sampleAns = store('sample/1.ans', '12\n');
  const test1In = store('test/1.in', '7 5\n');
  const test1Ans = store('test/1.ans', '12\n');
  const test2In = store('test/2.in', '0 1000000000\n');
  const test2Ans = store('test/2.ans', '1000000000\n');

  const cppProfile = {
    id: 'builtin-cpp17',
    name: 'GNU C++17',
    language: 'CPP17' as const,
    version: 1,
    hash: digest('cpp17'),
    config: { optimization: 'O2' as const, warnings: true, compileTimeMs: 10000, compileMemoryMb: 512 },
  };

  const sampleTest = {
    id: 't-sample',
    revisionId: 'r-sample',
    version: 1,
    number: 1,
    groupName: 'sample',
    isSample: true,
    enabled: true,
    notes: '两轮展示样例',
    input: sampleIn,
    answer: sampleAns,
    provenance: null,
    communication: { firstOutput: '7\n', secondInput: 'second\n7 5\n' },
  };

  const manifest: ProblemManifest = {
    schemaVersion: 1,
    problemId: 'p-comm',
    meta: { title: '通信题入门', tags: ['通信题'], notes: '', responsibleId: null },
    documents: [{
      id: 'd-stmt',
      revisionId: 'dr-1',
      version: 1,
      language: 'zh-CN',
      kind: 'STATEMENT',
      enabled: true,
      body: '\\Description\nAlice 有 $a$，Bob 有 $b$。\n\\InputFile\n两轮输入。\n\\OutputFile\n输出 $a+b$。\n\\Note\n两轮独立进程。',
      metadata: { title: '通信题入门', author: '出题人' },
      sampleRevisionIds: ['r-sample'],
      template: null,
    }],
    programs: [
      {
        id: 'p-interactor',
        revisionId: 'pr-int',
        version: 1,
        name: 'interactor',
        role: 'INTERACTOR',
        source: INTERACTOR_SRC,
        sourceHash: digest(INTERACTOR_SRC),
        enabled: true,
        notes: '',
        expectedVerdicts: ['AC'],
        profile: cppProfile,
      },
      ...(checkerMode === 'CUSTOM' ? [{
        id: 'p-checker',
        revisionId: 'pr-chk',
        version: 1,
        name: 'checker',
        role: 'CHECKER' as const,
        source: CHECKER_SRC,
        sourceHash: digest(CHECKER_SRC),
        enabled: true,
        notes: '',
        expectedVerdicts: ['AC' as const],
        profile: cppProfile,
      }] : []),
    ],
    tests: [
      sampleTest,
      { id: 't-1', revisionId: 'r-1', version: 1, number: 2, groupName: 'main', isSample: false, enabled: true, notes: '', input: test1In, answer: test1Ans, provenance: null },
      { id: 't-2', revisionId: 'r-2', version: 1, number: 3, groupName: 'main', isSample: false, enabled: true, notes: '', input: test2In, answer: test2Ans, provenance: null },
    ],
    samples: [{ ...sampleTest, input: { ...sampleIn }, answer: { ...sampleAns }, communication: { ...sampleTest.communication } }],
    assets: [],
    plans: [],
    selfTests: [],
    groups: null,
    stress: null,
    judgeSettings: {
      ...defaultJudgeSettings,
      interactionMode: 'COMMUNICATION',
      checkerMode,
      communication: { ...defaultCommunicationSettings, outputLimitBytes: 1_048_576 },
    },
  };

  return { manifest, read: async (key: string) => blobs.get(key)! };
}

test('communication samples are excluded from judging data while hidden tests remain', () => {
  const settings = { interactionMode: 'COMMUNICATION' as const };
  assert.equal(isJudgingData(settings, { isSample: true, enabled: true }), false);
  assert.equal(isJudgingData(settings, { isSample: false, enabled: true }), true);
  assert.equal(isJudgingData(settings, { isSample: false, enabled: false }), false);
});

test('NovaJudge communication export matches Run-Twice protocol and 4-part sample format', async () => {
  const support = {
    testlib: await readFile(join(root, 'vendor/testlib/testlib.h')),
    license: await readFile(join(root, 'vendor/testlib/LICENSE')),
  };
  for (const checkerMode of ['CUSTOM', 'TOKENS'] as const) {
    const { manifest, read } = makeCommunicationManifest(checkerMode);
    const result = await exportNovaJudgeProblem(manifest, read, support);
    const problemJsonKey = [...result.files.keys()].find(k => k.endsWith('/problem.json'))!;
    const problemYmlKey = [...result.files.keys()].find(k => k.endsWith('/data/problem.yml'))!;
    const problemJson = JSON.parse(result.files.get(problemJsonKey)!.toString('utf8'));
    const problemYml = result.files.get(problemYmlKey)!.toString('utf8');

    assert.equal(problemJson.type, 'communication');
    assert.equal(problemJson.judgeConfig.type, 'communication');
    assert.deepEqual(problemJson.judgeConfig.polygon, { run_count: 2, interactor_runs: [1], sample_cases: [] });
    assert.deepEqual(problemJson.judgeConfig.communication, { output_limit: 1_048_576 });
    assert.equal(problemJson.judgeConfig.interactor, 'interactor.cpp');
    assert.equal(problemJson.judgeConfig.checker, 'checker.cpp');
    assert.equal(problemJson.judgeConfig.cases.length, 2);
    assert.match(problemYml, /type:\s*communication/);
    assert.match(problemYml, /run_count:\s*2/);
    assert.match(problemYml, /interactor_runs:\s*\n\s*-\s*1/);
    assert.match(problemYml, /output_limit:\s*1048576/);

    assert.equal(problemJson.samples.length, 1);
    assert.deepEqual(problemJson.samples[0], {
      input: 'first\n7\n',
      output: '',
      communication: {
        firstOutput: '7\n',
        secondInput: 'second\n7 5\n',
        secondOutput: '12\n',
      },
    });

    const checkerFile = result.files.get(problemJsonKey.replace('problem.json', 'data/checker.cpp'))!.toString('utf8');
    if (checkerMode === 'CUSTOM') assert.match(checkerFile, /registerTestlibCmd/);
    else assert.match(checkerFile, /Generated by ProblemForge: TOKENS/);
  }
});

test('Hydro communication export synthesizes native type=communication manager.cpp', async () => {
  const support = {
    testlib: await readFile(join(root, 'vendor/testlib/testlib.h')),
    license: await readFile(join(root, 'vendor/testlib/LICENSE')),
  };
  for (const checkerMode of ['CUSTOM', 'TOKENS'] as const) {
    const { manifest, read } = makeCommunicationManifest(checkerMode);
    const result = await exportHydroProblem(manifest, read, support, { exportedAt: new Date('2026-11-24T12:00:00Z') });
    const prefix = [...result.files.keys()][0].split('/')[0];
    const configYaml = result.files.get(`${prefix}/testdata/config.yaml`)!.toString('utf8');
    const problemMd = result.files.get(`${prefix}/problem.md`)!.toString('utf8');
    const managerCpp = result.files.get(`${prefix}/testdata/manager.cpp`)!.toString('utf8');

    assert.match(configYaml, /type:\s*communication/);
    assert.match(configYaml, /num_processes:\s*2/);
    assert.match(configYaml, /manager:\s*manager\.cpp/);
    assert.match(configYaml, /judge_extra_files:\s*\n\s*-\s*polygon-testlib\.h\s*\n\s*-\s*2\.ans\s*\n\s*-\s*3\.ans/);
    assert.match(configYaml, /input:\s*2\.in\s*\n\s*output:\s*2\.ans/);
    assert.match(configYaml, /input:\s*3\.in\s*\n\s*output:\s*3\.ans/);
    assert.equal(result.files.has(`${prefix}/testdata/polygon-testlib.h`), true);
    assert.equal(result.files.has(`${prefix}/testdata/testlib.h`), false);
    assert.equal(result.files.has(`${prefix}/testdata/compile.sh`), false);
    assert.equal(result.files.has(`${prefix}/testdata/phase-runner.py`), false);

    assert.match(problemMd, /```input1\nfirst\n7\n```/);
    assert.match(problemMd, /```output1\n7\n```/);
    assert.match(problemMd, /```input2\nsecond\n7 5\n```/);
    assert.match(problemMd, /```output2\n12\n```/);

    assert.match(managerCpp, /TESTLIB_THROW_EXIT_EXCEPTION_INSTEAD_OF_EXIT/);
    assert.match(managerCpp, /#include "polygon-testlib\.h"/);
    assert.match(managerCpp, /HYDRO_TESTCASE/);
    assert.match(managerCpp, /namespace pf_pass1/);
    assert.match(managerCpp, /namespace pf_pass2/);
    if (checkerMode === 'CUSTOM') assert.match(managerCpp, /registerTestlibCmd/);
    else assert.match(managerCpp, /pf_tokens/);
  }
});

test('Native v1 export/import round-trips communication settings and 4-part communication samples', async () => {
  const { manifest, read } = makeCommunicationManifest('CUSTOM');
  const exported = await nativeExporter.export(manifest, 'FULL', read);
  const imported = importNative(exported.files);
  validateManifest(imported.manifest);
  assert.equal(imported.manifest.judgeSettings.interactionMode, 'COMMUNICATION');
  assert.equal(imported.manifest.judgeSettings.communication?.outputLimitBytes, 1_048_576);
  assert.deepEqual(imported.manifest.samples[0].communication, { firstOutput: '7\n', secondInput: 'second\n7 5\n' });
});

test('Template engine renders 4-part communication samples and rejects invalid sample paths', () => {
  const templateFiles = {
    'manifest.yaml': `protocolVersion: 1\nkind: STATEMENT\nentry: main.tex\nprofile: ${TEX_PROFILE}\nlanguages: [zh-CN]\nsingle: true\ncontest: false\n`,
    'metadata.schema.json': '{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string","maxLength":160},"author":{"type":"string","maxLength":160}}}',
    'main.tex': '\\documentclass{article}\n\\begin{document}\n{{BODY}}\n\\end{document}\n',
    'preview.tex': '\\Description\npreview',
  };
  const rendered = render(
    templateFiles,
    'STATEMENT',
    '\\Description\n测试通信样例。\n\\Note\n说明。',
    { title: '通信题', author: '作者' },
    [],
    'single',
    [{
      inputPath: 'samples/sample-1.in',
      answerPath: 'samples/sample-1.ans',
      firstOutputPath: 'samples/sample-1.p1out',
      secondInputPath: 'samples/sample-1.p2in',
    }],
  );
  assert.match(rendered['samples.tex'], /\\pfcommsample\{samples\/sample-1\.in\}\{samples\/sample-1\.p1out\}\{samples\/sample-1\.p2in\}\{samples\/sample-1\.ans\}/);
  assert.throws(() => render(
    templateFiles,
    'STATEMENT',
    '\\Description\n坏路径',
    { title: '通信题', author: '作者' },
    [],
    'single',
    [{
      inputPath: 'samples/sample-1.in',
      answerPath: 'samples/sample-1.ans',
      firstOutputPath: '../etc/passwd',
      secondInputPath: 'samples/sample-1.p2in',
    }],
  ));
});
