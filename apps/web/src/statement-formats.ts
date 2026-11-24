import interactiveBody from '../../../templates/content/interactive-statement.tex?raw';
import communicationBody from '../../../templates/content/communication-statement.tex?raw';

export const statementFormats = [
  { id: 'interactive', label: '通用交互题格式', description: '题目描述、初始信息、询问、回答、交互注意事项与交互示例。', body: interactiveBody, title: '' },
  { id: 'communication', label: '通用通信题格式（first / second）', description: '双轮独立运行说明、first/second 输入输出格式、协议限制与注意事项。', body: communicationBody, title: '' },
] as const;

export type StatementFormatApplication = { body: string; mode: 'replace' | 'append'; title?: string };
