import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatGeneratorCommands, parseGeneratorCommands, generatorPlanCommands, generatorPlanProgramIds, remapGeneratorPlanPrograms, type GeneratorCommand, type GeneratorPlanSave } from '@problemforge/contracts';
import { blankManifest, digest, nativeExporter, importNative, validateManifest } from '../packages/problem-format/src/native.ts';

const generators = [{ id: 'gen-1', name: 'gen' }, { id: 'gen-2', name: 'edge gen' }];
const plan = (commands: GeneratorCommand[]): GeneratorPlanSave => ({ name: '逐行计划', programId: commands[0].programId ?? 'gen-1', enabled: true, argv: commands[0].argv, seed: commands[0].seed, count: commands.length, numberStart: 11, groupName: 'main', isSample: false, commands });

test('the nine requested lines keep n and seed paired after saving and reopening', () => {
  const text = Array.from({ length: 9 }, (_, i) => `gen ${i + 1} ${10001 + i}`).join('\r\n');
  const saved = JSON.parse(JSON.stringify(plan(parseGeneratorCommands(text, generators))));
  const commands = generatorPlanCommands(saved);
  assert.deepEqual(commands.map(command => [command.programId, ...command.argv, command.seed]), Array.from({ length: 9 }, (_, i) => ['gen-1', String(i + 1), String(10001 + i)]));
  assert.deepEqual(parseGeneratorCommands(formatGeneratorCommands(generators, commands), generators), commands);
});

test('mixed generators, whitespace, quoted arguments and exact seeds round-trip', () => {
  const commands = parseGeneratorCommands('\n gen\t1 10001\r\n"edge gen" "two words" \'\' -42\n', generators);
  assert.deepEqual(commands, [{ programId: 'gen-1', argv: ['1'], seed: '10001' }, { programId: 'gen-2', argv: ['two words', ''], seed: '-42' }]);
  const literals = [{ programId: 'gen-2', argv: ['tab\there', 'a"b', "a'b", 'a\\b', '$literal', ';', ''], seed: '00012' }];
  assert.deepEqual(parseGeneratorCommands(formatGeneratorCommands(generators, literals), generators), literals);
  assert.deepEqual(generatorPlanProgramIds(plan(commands)), ['gen-1', 'gen-2']);
});

test('invalid lines report their original line without accepting shell commands', () => {
  for (const command of ['unknown 1 10001', 'gen 1 seed', 'gen', 'gen "unclosed 1', 'gen 1 10001 > out.in', 'gen 1 10001; other 2', 'gen $(other) 1', 'gen 1\0 1']) {
    assert.throws(() => parseGeneratorCommands(`gen 1 10001\n\n${command}`, generators), /第 3 行/);
  }
  assert.throws(() => parseGeneratorCommands('gen 1 1', [...generators, { id: 'another', name: 'gen' }]), /名称.*重复/);
  assert.throws(() => parseGeneratorCommands(Array.from({ length: 101 }, () => 'gen 1 1').join('\n'), generators), /100 条/);
  assert.throws(() => parseGeneratorCommands(`gen ${'a'.repeat(513)} 1`, generators), /512/);
  assert.throws(() => parseGeneratorCommands('gen 1 1000000000000000000', generators), /18 位/);
});

test('legacy fixed-argument plans still increment only seeds, and inconsistent new plans fail', () => {
  const old = { ...plan([{ argv: ['100'], seed: '999999999999999997' }]), commands: undefined, count: 3 };
  assert.deepEqual(generatorPlanCommands(old), [
    { argv: ['100'], seed: '999999999999999997' }, { argv: ['100'], seed: '999999999999999998' }, { argv: ['100'], seed: '999999999999999999' },
  ]);
  const saved = plan(parseGeneratorCommands('gen 1 1\ngen 2 7', generators));
  assert.throws(() => generatorPlanCommands({ ...saved, count: 3 }), /数量不一致/);
  assert.throws(() => generatorPlanCommands({ ...saved, seed: '2' }), /摘要/);
  assert.throws(() => generatorPlanCommands({ ...saved, programId: 'gen-2' }), /第一条命令/);
  assert.throws(() => generatorPlanCommands({ ...saved, numberStart: 100000 }), /编号/);
});

test('native packages retain all commands and copied problems remap every generator', async () => {
  const manifest = blankManifest('逐行命令');
  manifest.programs = generators.map(generator => ({ ...generator, revisionId: generator.id + '-v1', version: 1, role: 'GENERATOR', source: 'source', sourceHash: digest('source'), enabled: true, expectedVerdicts: ['AC'], notes: '', profile: { id: 'cpp17', name: 'C++17', version: 1, language: 'CPP17', hash: 'a'.repeat(64), config: { optimization: 'O2', warnings: true, compileTimeMs: 10000, compileMemoryMb: 512 } } }));
  const original = plan(parseGeneratorCommands('gen 1 10001\n"edge gen" 9 10009', generators));
  manifest.plans.push({ ...original, id: 'plan', version: 1 });
  validateManifest(manifest);
  const exported = await nativeExporter.export(manifest, 'FULL', async () => { throw new Error('No blobs expected'); });
  const imported = importNative(exported.files).manifest.plans[0];
  assert.deepEqual(imported.commands, original.commands);
  const remapped = remapGeneratorPlanPrograms(imported, new Map([['gen-1', 'new-1'], ['gen-2', 'new-2']]));
  assert.equal(remapped.programId, 'new-1');
  assert.deepEqual(generatorPlanCommands(remapped).map(command => command.programId), ['new-1', 'new-2']);
  assert.throws(() => remapGeneratorPlanPrograms(imported, new Map([['gen-1', 'new-1']])), /缺少映射/);
  const invalid = structuredClone(manifest); invalid.plans[0].commands![1].programId = 'foreign-generator';
  assert.throws(() => validateManifest(invalid), /程序缺失/);
});
