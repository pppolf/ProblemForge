import { getParser } from '@unified-latex/unified-latex-util-parse';
import { printRaw } from '@unified-latex/unified-latex-util-print-raw';
import type * as Ast from '@unified-latex/unified-latex-types';
import { PackageError } from './archive.ts';

const parser = getParser({ macros: { exmp: { signature: 'm m' }, mat: { signature: 'm' } } });
const sections: Record<string, [string, string]> = {
  Description: ['题目描述', 'Description'], InputFile: ['输入格式', 'Input'], OutputFile: ['输出格式', 'Output'],
  Examples: ['样例', 'Examples'], Example: ['样例', 'Example'], Note: ['说明', 'Note'], Notes: ['说明', 'Notes'],
  Explanation: ['样例解释', 'Explanation'], Explanations: ['样例解释', 'Explanations'], Constraints: ['数据范围', 'Constraints'],
  Background: ['题目背景', 'Background'], Specification: ['规格说明', 'Specification'], Interaction: ['交互协议', 'Interaction'],
  Scoring: ['评分方式', 'Scoring'], Illustration: ['示意', 'Illustration'], interactor: ['交互格式', 'Interaction'],
  InteractionStart: ['初始信息', 'Initial information'], InteractionQuery: ['询问', 'Queries'], InteractionAnswer: ['回答', 'Answers'],
  InteractionNotes: ['交互注意事项', 'Interaction notes'], InteractionExample: ['交互示例', 'Interaction example'],
};
const escapedTex: Record<string, string> = { '%': '%', '&': '&', '_': '_', '#': '#', '$': '$', '{': '{', '}': '}', ' ': ' ', backslash: '\\', textbackslash: '\\', LaTeX: 'LaTeX', TeX: 'TeX' };
export const escapeMarkdown = (text: string) => text.replace(/[\\`*_{}\[\]<>#!|$]/g, '\\$&');
const block = (text: string) => `\n\n${text}\n\n`;
export function fencedCode(text: string, language = 'text') {
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));
  return `${fence}${language}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}`;
}
const inlineCode = (text: string) => {
  const fence = '`'.repeat(Math.max(1, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));
  const pad = /^`|`$|^ .* $/s.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
};
const environmentName = (node: Ast.Environment) => typeof node.env === 'string' ? node.env : printRaw(node.env);

// Read structure only: no TeX compilation, template execution or external resources.
export type MarkdownSample = { input: string; output: string };
export function latexToMarkdown(body: string, options: { language?: string; samples?: MarkdownSample[]; statement?: boolean; structuredStatement?: boolean; assetUrl?: (path: string) => string } = {}) {
  if (body.length > 500_000 || body.includes('\0')) throw new PackageError('LaTeX 正文超出转换限制');
  let root: Ast.Root;
  try { root = parser.parse(body); } catch { throw new PackageError('LaTeX 正文无法解析，请先修正括号或环境配对'); }
  let count = 0;
  const check = (node: Ast.Node | Ast.Argument, depth: number) => {
    if (++count > 50_000 || depth > 100) throw new PackageError('LaTeX 正文结构超出转换限制');
    if ('content' in node && Array.isArray(node.content)) for (const child of node.content) check(child, depth + 1);
    if ('args' in node && node.args) for (const arg of node.args) check(arg, depth + 1);
  };
  check(root, 0);
  const warnings = new Set<string>(), assets = new Set<string>(), english = options.language?.startsWith('en');
  const label = (zh: string, en: string) => english ? en : zh;
  let sampleNumber = 0;
  const statementSamples: MarkdownSample[] = [];
  const sample = ({ input, output }: MarkdownSample) => {
    statementSamples.push({ input, output });
    if (options.structuredStatement) return '';
    const number = ++sampleNumber;
    return `${fencedCode(input, `input${number}`)}\n\n${fencedCode(output, `output${number}`)}`;
  };
  const argument = (node: Ast.Macro) => node.args?.filter(a => a.openMark === '{').at(-1)?.content ?? [];
  const literal = (nodes: Ast.Node[]) => {
    const start = nodes[0]?.position?.start.offset, end = nodes.at(-1)?.position?.end.offset;
    return start !== undefined && end !== undefined ? body.slice(start, end) : printRaw(nodes);
  };
  const plain = (nodes: Ast.Node[]) => printRaw(nodes).replace(/\\([%&_#$\{\}])/g, '$1').replace(/~/g, ' ');
  const math = (nodes: Ast.Node[]): string => {
    const normalize = (node: Ast.Node): Ast.Node => {
      if (node.type === 'comment') return { type: 'whitespace' };
      const n = { ...node };
      if ('content' in n && Array.isArray(n.content)) n.content = n.content.map(normalize);
      if ('args' in n && n.args) n.args = n.args.map(a => ({ ...a, content: a.content.map(normalize) }));
      if (n.type === 'macro' && n.content === 'mat' && n.args?.length) {
        const a = n.args[0]; n.content = 'boldsymbol'; n.args = [{ ...a, content: [{ type: 'macro', content: 'mathrm', args: [a] }] }];
      }
      return n;
    };
    return printRaw(nodes.map(normalize)).trim();
  };
  const fallback = (node: Ast.Node, name: string, inline = false) => {
    warnings.add(`${name} 无对应 Markdown 结构，已保留为 LaTeX 代码，请核对该处。`);
    return inline ? inlineCode(printRaw(node)) : block(fencedCode(printRaw(node), 'latex'));
  };
  const render = (nodes: Ast.Node[]): string => {
    let result = '';
    for (const node of nodes) {
      const part = convert(node);
      if (part === ' ') { if (result && !/\s$/.test(result)) result += part; }
      else if (part.startsWith('\n\n')) result = result.trimEnd() + part;
      else result += part;
    }
    return result;
  };
  const list = (node: Ast.Environment) => {
    let index = 0;
    const items: string[] = [];
    for (const child of node.content) {
      if (child.type === 'macro' && child.content === 'item') {
        const prefix = environmentName(node) === 'enumerate' ? `${++index}. ` : '- ';
        const title = child.args?.find(a => a.openMark === '[');
        const content = `${title?.content.length ? `**${render(title.content).trim()}** ` : ''}${render(child.args?.[3]?.content ?? []).trim()}`;
        items.push(prefix + content.split('\n').join('\n' + ' '.repeat(prefix.length)));
      } else if (!['whitespace', 'parbreak', 'comment'].includes(child.type)) items.push(render([child]).trim());
    }
    return block(items.join('\n\n'));
  };
  const table = (node: Ast.Environment) => {
    // Merged cells cannot be represented faithfully by a Markdown pipe table.
    if (node.content.some(n => n.type === 'macro' && n.content === 'multicolumn')) return fallback(node, '合并单元格表格');
    const rows: string[][] = []; let row: string[] = [], cell: Ast.Node[] = [];
    const cellDone = () => { row.push(render(cell).trim().replace(/\n+/g, '<br>')); cell = []; };
    const rowDone = () => { cellDone(); if (row.some(c => c.length)) rows.push(row); row = []; };
    for (const child of node.content) {
      if (child.type === 'string' && child.content === '&') cellDone();
      else if (child.type === 'macro' && child.content === '\\') rowDone();
      else if (child.type === 'macro' && ['hline', 'cline', 'toprule', 'midrule', 'bottomrule'].includes(child.content)) continue;
      else cell.push(child);
    }
    rowDone();
    if (!rows.length) return '';
    const width = Math.max(...rows.map(r => r.length));
    // A literal pipe inside math or inline code still needs escaping in a pipe table.
    const line = (r: string[]) => '| ' + Array.from({ length: width }, (_, i) => (r[i] ?? '').replace(/(?<!\\)\|/g, '\\|')).join(' | ') + ' |';
    return block([line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n'));
  };
  const convert = (node: Ast.Node): string => {
    switch (node.type) {
      case 'string': return escapeMarkdown(node.content.replace(/~/g, ' '));
      case 'whitespace': return ' ';
      case 'parbreak': return '\n\n';
      case 'comment': return node.suffixParbreak ? '\n\n' : '';
      case 'root': case 'group': return render(node.content);
      case 'verb': return inlineCode(node.content);
      case 'verbatim': return block(fencedCode(node.content.replace(/^\r?\n/, '')));
      case 'inlinemath': return `$${math(node.content)}$`;
      case 'displaymath': return block(`$$\n${math(node.content)}\n$$`);
      case 'mathenv': {
        const env = environmentName(node).replace(/\*$/, ''), content = math(node.content);
        const inner = env === 'equation' ? content : `\\begin{${env === 'align' ? 'aligned' : env === 'gather' ? 'gathered' : env}}${content}\\end{${env === 'align' ? 'aligned' : env === 'gather' ? 'gathered' : env}}`;
        return block(`$$\n${inner}\n$$`);
      }
      case 'environment': {
        const env = environmentName(node);
        if (['itemize', 'enumerate', 'description'].includes(env)) return list(node);
        if (env === 'tabular') return table(node);
        if (['center', 'figure', 'table', 'example', 'examplewide'].includes(env)) return block(render(node.content).trim());
        if (['quote', 'quotation'].includes(env)) return block(render(node.content).trim().split('\n').map(line => `> ${line}`).join('\n'));
        if (env === 'centerverbatim') return block(fencedCode(literal(node.content).replace(/^\r?\n/, '')));
        return fallback(node, `环境 ${env}`);
      }
      case 'macro': {
        const name = node.content;
        if (options.statement && ['Example', 'Examples'].includes(name)) return '';
        if (options.statement && sampleNumber && ['Note', 'Notes'].includes(name)) return block(`## ${label('样例解释', 'Sample explanation')}`);
        if (sections[name]) return block(`${['InteractionStart', 'InteractionQuery', 'InteractionAnswer'].includes(name) ? '###' : '##'} ${sections[name][english ? 1 : 0]}`);
        if (['section', 'subsection', 'subsubsection', 'paragraph'].includes(name)) return block(`${'#'.repeat(['section', 'subsection', 'subsubsection', 'paragraph'].indexOf(name) + 2)} ${render(argument(node)).trim()}`);
        if (['textbf', 'textit', 'emph', 'underline'].includes(name)) {
          const text = render(argument(node)).trim();
          return text ? `${['textbf', 'underline'].includes(name) ? '**' : '*'}${text}${['textbf', 'underline'].includes(name) ? '**' : '*'}` : '';
        }
        if (name === 'texttt') return inlineCode(plain(argument(node)));
        if (['text', 'textrm', 'textsf'].includes(name)) return render(argument(node));
        if (name === 'mat') return `$\\boldsymbol{\\mathrm{${math(argument(node))}}}$`;
        if (name === 'includegraphics') {
          const path = printRaw(argument(node)).trim();
          if (!/^assets\/[a-z0-9]+\.(png|jpg)$/.test(path)) throw new PackageError(`图片引用无法打包：${path.slice(0, 160)}`);
          assets.add(path); return block(`![${label('题目插图', 'Illustration')}](${options.assetUrl?.(path) ?? path})`);
        }
        if (name === 'exmp') {
          const args = node.args?.filter(a => a.openMark === '{') ?? [];
          if (args.length !== 2) return fallback(node, '样例');
          return block(sample({ input: literal(args[0].content), output: literal(args[1].content) }));
        }
        if (name === 'footnote') return `（${render(argument(node)).trim()}）`;
        if (name === 'caption') return block(render(argument(node)).trim());
        if (['centering', 'noindent'].includes(name)) return '';
        if (['newline', 'linebreak', '\\'].includes(name)) return '  \n';
        if ([',', ';', ':', '!', 'quad', 'qquad', 'enspace', 'thinspace'].includes(name)) return ' ';
        if (name in escapedTex) return escapeMarkdown(escapedTex[name]);
        if (name === 'ldots' || name === 'dots') return '…';
        return fallback(node, `命令 \\${name}`, true);
      }
      default: return fallback(node, `节点 ${(node as Ast.Node).type}`);
    }
  };
  // Render in order so embedded and bound samples share one sequence of pair IDs.
  const note = root.content.findIndex(n => n.type === 'macro' && ['Note', 'Notes', 'Explanation', 'Explanations'].includes(n.content));
  const offset = note < 0 ? root.content.length : note;
  const statementSections: { title: string; content: string }[] = [], hints: string[] = [];
  if (options.structuredStatement) {
    let title = 'Problem Description', hint = false, pending: Ast.Node[] = [];
    const flush = () => {
      const content = render(pending).trim(); pending = [];
      if (content) { if (hint) hints.push(content); else statementSections.push({ title, content }); }
    };
    const titles: Record<string, string> = { Description: 'Problem Description', InputFile: 'Input', OutputFile: 'Output', Interaction: 'Interaction', interactor: 'Interaction' };
    const namedTitles: Record<string, string> = { '题目描述': 'Problem Description', Description: 'Problem Description', '输入格式': 'Input', '输出格式': 'Output', '交互协议': 'Interaction', '交互格式': 'Interaction' };
    const hintTitles = new Set(['说明', '提示', '样例解释', 'Note', 'Notes', 'Hint', 'Explanation', 'Explanations', 'Sample explanation']);
    for (let i = 0; i <= root.content.length; i++) {
      if (i === offset) { flush(); for (const value of options.samples ?? []) sample(value); }
      const node = root.content[i]; if (!node) break;
      if (node.type === 'macro') {
        const name = node.content;
        if (['Example', 'Examples'].includes(name)) continue;
        if (['Note', 'Notes', 'Explanation', 'Explanations'].includes(name)) { flush(); hint = true; continue; }
        // Preserve subheadings within the section; only top-level headings split it.
        if ((sections[name] && !['InteractionStart', 'InteractionQuery', 'InteractionAnswer'].includes(name)) || name === 'section') {
          flush();
          const heading = name === 'section' ? plain(argument(node)).trim() : (titles[name] ?? sections[name][1]);
          title = namedTitles[heading] ?? heading; hint = hintTitles.has(heading); continue;
        }
      }
      pending.push(node);
    }
    flush();
    return { markdown: '', sections: statementSections, samples: statementSamples, hint: hints.join('\n\n'), assets: [...assets], warnings: [...warnings] };
  }
  let markdown = options.samples?.length
    ? render(root.content.slice(0, offset)).trim() + block(options.samples.map(sample).join('\n\n')) + render(root.content.slice(offset)).trim()
    : render(root.content).trim();
  if (options.statement && markdown.trim() && !/^#{1,6} /.test(markdown.trimStart())) markdown = `## ${label('题目描述', 'Description')}\n\n${markdown.trim()}`;
  return { markdown: markdown.trim() + '\n', sections: statementSections, samples: statementSamples, hint: '', assets: [...assets], warnings: [...warnings] };
}
