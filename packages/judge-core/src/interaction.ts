import type { SandboxResult, InteractionStop } from '@problemforge/judge-adapter';
import { checkerVerdict, executionVerdict } from './index.ts';
export const INTERACTION_POLICY = 'interaction-v1-29ce9f762fc4ce073b1216627fd56fae23b7ad5fc9d00dce9e06773aaec09478';
export function interactionVerdict(player: SandboxResult, interactor: SandboxResult, relay: SandboxResult, stop?: InteractionStop): { verdict: string; diagnostic: string } {
  const p = executionVerdict(player);
  const authorExit = stop?.kind === 'INTERACTOR_EXIT' ? stop.exitCode : undefined;
  const actualTool = authorExit === undefined ? interactor : { ...interactor, exitStatus: Math.abs(authorExit), status: authorExit === 0 ? 'Accepted' : authorExit < 0 ? 'Signalled' : 'Nonzero Exit Status' };
  const t = checkerVerdict(actualTool);
  if ([player, interactor, relay].some(r => executionVerdict(r) === 'INFRA_ERROR')) return { verdict: 'INFRA_ERROR', diagnostic: '交互环境或输入复制失败' };
  if (executionVerdict(relay) !== 'AC' && !(stop && relay.status === 'Signalled' && relay.exitStatus === 9) && !(stop?.kind === 'WALL' && relay.status === 'Time Limit Exceeded')) return { verdict: 'INFRA_ERROR', diagnostic: '可信管道中继异常退出' };
  if (stop?.kind === 'OUTPUT_LIMIT') return { verdict: stop.direction === 'CONTESTANT_TO_INTERACTOR' ? 'OLE' : 'TOOL_ERROR', diagnostic: '交互输出超过限制：' + stop.direction };
  if (['TLE', 'MLE', 'OLE'].includes(p)) return { verdict: p, diagnostic: '选手资源超限；工具读到 EOF 不覆盖原始资源判定' };
  if (stop?.kind === 'IDLE') return { verdict: 'TLE', diagnostic: '双方通信超过空闲时限；请检查 flush、EOF 和协议等待' };
  // A real testlib rejection survives the platform terminating its peer.
  if (['WA', 'PE'].includes(t)) return { verdict: t, diagnostic: 'Interactor 已作出有效判错；对端清理不覆盖判定' };
  if (['TLE', 'MLE', 'OLE'].includes(executionVerdict(interactor))) return { verdict: 'TOOL_ERROR', diagnostic: 'Interactor 资源超限' };
  if (stop?.kind === 'WALL') return { verdict: 'TLE', diagnostic: '交互达到总墙钟时限' };
  if (t === 'TOOL_ERROR') return { verdict: 'TOOL_ERROR', diagnostic: 'Interactor 异常退出或未作出有效判定' };
  if (p !== 'AC' && !(stop?.kind === 'INTERACTOR_EXIT' && player.status === 'Signalled' && player.exitStatus === 9)) return { verdict: p, diagnostic: '选手程序异常或资源超限' };
  return { verdict: 'AC', diagnostic: 'Interactor 接受交互结果' };
}
