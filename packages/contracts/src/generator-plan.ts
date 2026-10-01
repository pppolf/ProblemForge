import { Value } from '@sinclair/typebox/value';
import { GeneratorCommandInput, type GeneratorCommand, type GeneratorPlanSave } from './judge.ts';

type PlanCommands = Pick<GeneratorPlanSave, 'programId' | 'argv' | 'seed' | 'count' | 'commands' | 'numberStart'>;
export type GeneratorReference = { id: string; name: string };

export function generatorPlanProgramIds(plan: Pick<GeneratorPlanSave, 'programId' | 'commands'>): string[] {
  return [...new Set(plan.commands?.map(command => command.programId ?? plan.programId) ?? [plan.programId])];
}

export function remapGeneratorPlanPrograms(plan: GeneratorPlanSave, programIds: ReadonlyMap<string, string>): GeneratorPlanSave {
  const mapped = (id: string) => {
    const target = programIds.get(id);
    if (!target) throw new Error('生成计划引用的程序缺少映射');
    return target;
  };
  return { ...plan, programId: mapped(plan.programId), ...(plan.commands ? { commands: plan.commands.map(command => ({ ...command, ...(command.programId ? { programId: mapped(command.programId) } : {}) })) } : {}) };
}

/** Expand saved data only; no shell, process execution or parameter substitution. */
export function generatorPlanCommands(plan: PlanCommands): GeneratorCommand[] {
  if (!Number.isInteger(plan.count) || plan.count < 1 || plan.count > 100) throw new Error('每个生成计划需要 1～100 组数据');
  if (!Number.isInteger(plan.numberStart) || plan.numberStart < 1 || plan.numberStart + plan.count - 1 > 100000) throw new Error('生成数据编号必须在 1～100000 内');
  if (!Value.Check(GeneratorCommandInput, { argv: plan.argv, seed: plan.seed })) throw new Error('生成参数或种子格式无效');
  if (plan.commands !== undefined) {
    if (!Array.isArray(plan.commands) || plan.commands.length !== plan.count) throw new Error('逐行命令数量与生成数量不一致');
    for (const [i, command] of plan.commands.entries()) if (!Value.Check(GeneratorCommandInput, command)) throw new Error(`第 ${i + 1} 条命令参数或种子格式无效`);
    const first = plan.commands[0];
    if (JSON.stringify(first.argv) !== JSON.stringify(plan.argv) || first.seed !== plan.seed) throw new Error('计划参数摘要与第一条命令不一致');
    if (first.programId && first.programId !== plan.programId) throw new Error('计划生成器与第一条命令不一致');
    return plan.commands.map(command => ({ ...command, argv: [...command.argv] }));
  }
  return Array.from({ length: plan.count }, (_, i) => ({ argv: [...plan.argv], seed: (BigInt(plan.seed) + BigInt(i)).toString() }));
}

function tokens(line: string): string[] {
  const result: string[] = [];
  let token = '', quote = '', started = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '\\' && quote !== "'") {
      if (++i >= line.length) throw new Error('行末反斜杠缺少后续字符');
      token += line[i]; started = true;
    } else if (quote) {
      if (char === quote) quote = ''; else token += char;
    } else if (char === '"' || char === "'") {
      quote = char; started = true;
    } else if (char === ' ' || char === '\t') {
      if (started) { result.push(token); token = ''; started = false; }
    } else {
      if ('|&;<>`$'.includes(char)) throw new Error('这里只填写生成器和参数，不支持管道、重定向或 Shell 表达式');
      token += char; started = true;
    }
  }
  if (quote) throw new Error('引号未闭合');
  if (started) result.push(token);
  return result;
}

export function parseGeneratorCommands(text: string, generators: string | readonly GeneratorReference[]): GeneratorCommand[] {
  if (!generators.length) throw new Error('请先在「程序」保存生成器，命令首项使用程序名称');
  if (text.length > 200000) throw new Error('命令文本过长，最多 200000 个字符');
  const result: GeneratorCommand[] = [];
  for (const [i, line] of text.split(/\r\n|\r|\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const args = tokens(line.trim());
      let programId: string | undefined;
      if (typeof generators === 'string') {
        if (args[0] !== generators) throw new Error(`命令须以生成器名称 ${JSON.stringify(generators)} 开头`);
      } else {
        const matches = generators.filter(generator => generator.name === args[0]);
        if (!matches.length) throw new Error(`未找到名为 ${JSON.stringify(args[0])} 的生成器，请先在「程序」中保存`);
        if (matches.length > 1) throw new Error(`生成器名称 ${JSON.stringify(args[0])} 重复，请改为不同名称`);
        programId = matches[0].id;
      }
      if (args.length < 2) throw new Error('缺少末尾整数种子');
      const command = { argv: args.slice(1, -1), seed: args.at(-1)!, ...(programId ? { programId } : {}) };
      if (!/^-?[0-9]{1,18}$/.test(command.seed)) throw new Error('最后一个参数必须是整数种子（最多 18 位数字）');
      if (!Value.Check(GeneratorCommandInput, command)) throw new Error('最多 32 个参数，每个最多 512 字符，且不能含换行或空字符');
      result.push(command);
      if (result.length > 100) throw new Error('每个计划最多 100 条命令');
    } catch (error) { throw new Error(`第 ${i + 1} 行：${(error as Error).message}`); }
  }
  if (!result.length) throw new Error('请填写生成命令，每行一组数据');
  return result;
}

export function formatGeneratorCommands(generators: string | readonly GeneratorReference[], commands: GeneratorCommand[], defaultProgramId?: string): string {
  const quote = (text: string) => text && !/[\s"'\\|&;<>`$]/.test(text) ? text : '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return commands.map(command => {
    const name = typeof generators === 'string' ? generators : generators.find(generator => generator.id === (command.programId ?? defaultProgramId))?.name ?? '';
    return [name, ...command.argv, command.seed].map(quote).join(' ');
  }).join('\n');
}
