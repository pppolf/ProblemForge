import type { TestGroupsValue, ScoreExpectation } from '@problemforge/contracts';
import type { ProgramSnapshot } from './index.ts';
import { checkExpectation } from './index.ts';
export class GroupError extends Error {}
export function groupOrder(groups: TestGroupsValue['groups']) {
  const map = new Map(groups.map(g => [g.id, g]));
  if (map.size !== groups.length) throw new GroupError('数据组标识重复');
  if (groups.reduce((s,g)=>s+g.points,0) > 10000) throw new GroupError('总分不能超过 10000');
  const active = new Set<string>(), done = new Set<string>(), ordered: string[] = [], members = new Set<string>();
  for (const g of groups) {
    if (!g.members.length) throw new GroupError(`数据组 ${g.id} 不能为空`);
    for (const m of g.members) { if (members.has(m.testId)) throw new GroupError('一条正式数据只能属于一个计分组'); members.add(m.testId); }
  }
  const visit = (id: string) => {
    if (active.has(id)) throw new GroupError(`数据组依赖形成环：${id}`);
    if (done.has(id)) return;
    const g = map.get(id); if (!g) throw new GroupError(`依赖组不存在：${id}`);
    active.add(id); for (const dep of g.dependencies) visit(dep); active.delete(id); done.add(id); ordered.push(id);
  };
  for (const g of groups) visit(g.id);
  return ordered;
}
export type GroupScore = { id: string; rawScoreMilli: number; scoreMilli: number; fullScoreMilli: number; passedWeight: number; totalWeight: number; allPassed: boolean; blockedBy: string[] };
export type ScoreReport = { programId: string; groups: GroupScore[]; totalScoreMilli: number; maxScoreMilli: number; allPassed: boolean; healthy: boolean };
export function scoreGroups(programId: string, groups: TestGroupsValue['groups'], cases: { revisionId: string; verdict: string }[]): ScoreReport {
  const order = groupOrder(groups), results = new Map<string, GroupScore>(), verdicts = new Map(cases.map(c => [c.revisionId,c.verdict]));
  const healthy = cases.every(c => !['CE','TOOL_ERROR','INFRA_ERROR','SKIPPED','CANCELED'].includes(c.verdict)) && groups.every(g=>g.members.every(m=>verdicts.has(m.revisionId)));
  for (const id of order) {
    const g = groups.find(g => g.id === id)!;
    const allPassed = g.members.every(m=>verdicts.get(m.revisionId)==='AC');
    const totalWeight = g.members.reduce((s,m)=>s+m.weight,0), passedWeight = g.members.reduce((s,m)=>s+(verdicts.get(m.revisionId)==='AC'?m.weight:0),0);
    const fullScoreMilli = g.points*1000;
    // Integer fixed-point, floor per group to 0.001 points. No float accumulation.
    const rawScoreMilli = g.aggregation==='ALL' ? allPassed?fullScoreMilli:0 : Number(BigInt(fullScoreMilli)*BigInt(passedWeight)/BigInt(totalWeight));
    const blockedBy = g.dependencies.filter(d=>!results.get(d)!.allPassed||results.get(d)!.blockedBy.length>0);
    results.set(id,{id,rawScoreMilli,scoreMilli:blockedBy.length?0:rawScoreMilli,fullScoreMilli,passedWeight,totalWeight,allPassed,blockedBy});
  }
  const values=groups.map(g=>results.get(g.id)!);
  return {programId,groups:values,totalScoreMilli:values.reduce((s,g)=>s+g.scoreMilli,0),maxScoreMilli:values.reduce((s,g)=>s+g.fullScoreMilli,0),allPassed:cases.length>0&&cases.every(c=>c.verdict==='AC')&&values.every(g=>g.allPassed&&!g.blockedBy.length),healthy};
}
export function scoreExpectation(program: Pick<ProgramSnapshot, 'role' | 'expectedVerdicts' | 'expectedScore'>, score: ScoreReport, verdicts: string[]) {
  if (['MAIN_SOLUTION','CORRECT_SOLUTION'].includes(program.role)) return {passed:score.healthy&&score.allPassed&&score.totalScoreMilli===score.maxScoreMilli,diagnostic:'正确解要求所有必需数据 AC 且取得满分'};
  const expected: ScoreExpectation | undefined = program.expectedScore;
  if (!expected) return checkExpectation(program,verdicts);
  const inRange = (scoreMilli:number,r:{min:number;max:number}) => scoreMilli>=Math.round(r.min*1000)&&scoreMilli<=Math.round(r.max*1000);
  const passed=score.healthy&&(!expected.total||inRange(score.totalScoreMilli,expected.total))&&expected.groups.every(e=>{const g=score.groups.find(g=>g.id===e.groupId);return !!g&&inRange(g.scoreMilli,e);});
  return {passed,diagnostic:score.healthy?`总分 ${(score.totalScoreMilli/1000).toFixed(3)} / ${(score.maxScoreMilli/1000).toFixed(3)}；按依赖后的组分数与声明范围检查`:'编译/工具/基础设施错误不能算作分数预期命中'};
}
