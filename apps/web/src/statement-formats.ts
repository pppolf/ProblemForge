import interactiveBody from '../../../templates/content/interactive-statement.tex?raw';
import polynomialBody from '../../../templates/content/polynomial-machine-easy.tex?raw';

export const statementFormats = [
  { id: 'interactive', label: '通用交互题结构', description: '题目描述、初始信息、询问、回答、交互注意事项与交互示例。', body: interactiveBody, title: '' },
  { id: 'polynomial', label: '多项式机器（Easy Version）完整示例', description: '完整的多项式交互题面，包含询问约束、C++ 刷新示例及逐行交互过程。', body: polynomialBody, title: '多项式机器（Easy Version）' },
] as const;

export type StatementFormatApplication = { body: string; mode: 'replace' | 'append'; title?: string };
