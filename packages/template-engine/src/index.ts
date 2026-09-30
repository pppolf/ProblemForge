import { parse } from '@unified-latex/unified-latex-util-parse';
import type * as Ast from '@unified-latex/unified-latex-types';
import { parse as parseYaml } from 'yaml';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DocumentKind, AdminStyle } from '@problemforge/contracts';

export const POLICY_VERSION = 'pf-content-3';
export const TEX_PROFILE = 'xelatex-2022-bookworm-v1';
export type TemplateFiles = Record<string, string>;
export async function loadTemplateDirectory(directory: string, prefix = ''): Promise<TemplateFiles> {
  const files: TemplateFiles = {};
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('模板目录不允许符号链接');
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, await loadTemplateDirectory(directory, name));
    else if (entry.isFile() && /\.(tex|sty|cls|def|yaml|json|png|jpe?g)$/.test(name)) {
      const bytes = await readFile(join(directory, name)); files[name] = /\.(png|jpe?g)$/.test(name) ? bytes.toString('base64') : bytes.toString('utf8');
    }
  }
  return files;
}
export type PolicyIssue = { message: string; line: number; column: number };
export class ContentPolicyError extends Error {
  constructor(public issues: PolicyIssue[]) { super(issues[0]?.message ?? '内容策略拒绝'); }
}
// An allowlist over a PEG-parsed AST, independent of the OS execution sandbox.
// No definitions, expansion primitives, file I/O, packages, themes or document entry.
const commonMacros = new Set((
  'section subsection subsubsection paragraph text textbf textit emph texttt textrm textsf underline ' +
  'item label ref eqref pageref cite caption footnote frac dfrac tfrac sqrt binom dbinom ' +
  'sum prod int iint lim min max log ln exp sin cos tan gcd lcm mod bmod pmod cfrac ' +
  'in notin subset subseteq supset supseteq cup cap emptyset forall exists neg land lor ' +
  'le leq ge geq ne neq equiv approx sim simeq cong propto ' +
  'times cdot div pm mp circ ' +
  'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi ' +
  'pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega ' +
  'Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega ' +
  'left right big Big bigg Bigg langle rangle lceil rceil lfloor rfloor ' +
  'vert Vert mid overline hat widehat bar vec dot ddot tilde widetilde ' +
  'mathbb mathcal mathrm mathit mathsf mathtt mathbf operatorname ' +
  'infty partial nabla ldots cdots vdots ddots dots ' +
  'quad qquad hline cline multicolumn newline linebreak LaTeX TeX centering toprule midrule bottomrule ' +
  'to gets rightarrow leftarrow Rightarrow Leftarrow Leftrightarrow mapsto ' +
  '% & _ ^ # $ { } , ; : ! \\ space '
).split(/\s+/).filter(Boolean));
commonMacros.add(' ');
const beamerMacros = new Set('frametitle framesubtitle pause only uncover visible alert onscreen onslide column item'.split(' '));
const statementMacros = new Set('InputFile OutputFile Examples Example Note Notes Explanation Explanations Constraints Background Specification Interaction Scoring Illustration exmp mat'.split(' '));
const environments = new Set('itemize enumerate description center quote quotation tabular table figure equation equation* align align* aligned gather gather* cases matrix pmatrix bmatrix vmatrix Vmatrix smallmatrix verbatim'.split(' '));
const beamerEnvs = new Set('frame block alertblock exampleblock columns column overlayarea cwnublock'.split(' '));

function position(node: Ast.Node): { line: number; column: number } {
  return { line: node.position?.start.line ?? 1, column: node.position?.start.column ?? 1 };
}
export function validateBody(body: string, kind: DocumentKind, assetPaths: string[] = []) {
  const issues: PolicyIssue[] = [];
  const usedAssets = new Set<string>();
  function literal(nodes: Ast.Node[], dimensions = false): string {
    return nodes.map(n => {
      if (n.type === 'string') return n.content;
      if (n.type === 'whitespace') return ' ';
      if (dimensions && n.type === 'macro' && ['linewidth', 'textwidth'].includes(n.content)) return `\\${n.content}`;
      throw new Error('图片路径和尺寸必须使用受限字面量');
    }).join('');
  }
  function graphic(node: Ast.Macro) {
    try {
      const args = node.args ?? [];
      if (args.length !== 4 || args[0].content.length || args[2].content.length) throw new Error('不支持此图片参数形式');
      const path = literal(args[3].content);
      if (!/^assets\/[a-z0-9]+\.(png|jpg)$/.test(path) || !assetPaths.includes(path)) throw new Error('图片必须引用本题已经上传的 PNG/JPEG 资源路径');
      const options = literal(args[1].content, true).replace(/\s/g, '');
      const keys = new Set<string>();
      if (options) for (const option of options.split(',')) {
        const match = /^(width|height)=(\d*\.?\d+)(mm|cm|in|pt|\\linewidth|\\textwidth)$/.exec(option);
        if (!match || keys.has(match[1])) throw new Error('图片仅允许 width / height 尺寸参数');
        const maximum: Record<string, number> = { mm: 250, cm: 25, in: 9.8, pt: 710, '\\linewidth': 1, '\\textwidth': 1 };
        if (!(Number(match[2]) > 0 && Number(match[2]) <= maximum[match[3]])) throw new Error('图片尺寸超出批准范围');
        keys.add(match[1]);
      }
      usedAssets.add(path);
    } catch (e) { issues.push({ ...position(node), message: (e as Error).message }); }
  }
  // TeX's ^^ preprocessing precedes tokenization and would undermine an AST allowlist.
  // Explicitly excluded by the content language; it is not an execution sandbox.
  const offset = body.indexOf('^^');
  if (offset >= 0) {
    const before = body.slice(0, offset).split('\n');
    issues.push({ message: '内容子集不支持 TeX ^^ 字符预处理', line: before.length, column: before.at(-1)!.length + 1 });
  }
  if (body.includes('\u0000')) issues.push({ message: '正文包含 NUL 字符', line: 1, column: 1 });
  try {
    const tree = parse(body);
    let nodes = 0;
    function walk(node: Ast.Node, depth = 0) {
      if (++nodes > 50000 || depth > 100) throw new Error('正文结构过于复杂');
      if (node.type === 'macro') {
        if (node.content === 'includegraphics') { graphic(node); return; }
        if (!commonMacros.has(node.content) && !(kind === 'EDITORIAL_BEAMER' && beamerMacros.has(node.content)) && !(kind === 'STATEMENT' && statementMacros.has(node.content))) {
          issues.push({ ...position(node), message: `\\${node.content} 不在批准的内容语法中；宏、资源及全局排版需由管理员提供` });
        }
      }
      if (node.type === 'environment' || node.type === 'mathenv') {
        if (!environments.has(node.env) && !(kind === 'EDITORIAL_BEAMER' && beamerEnvs.has(node.env)) && !(kind === 'STATEMENT' && ['example', 'examplewide', 'centerverbatim'].includes(node.env))) {
          issues.push({ ...position(node), message: `环境 ${node.env} 不在本类型批准的内容语法中` });
        }
        if (node.env === 'verbatim' || node.env === 'centerverbatim') return; // Literal code is not reinterpreted as TeX.
      }
      const child = node as unknown as { content?: Ast.Node[]; args?: { content: Ast.Node[] }[] };
      if (Array.isArray(child.content)) for (const item of child.content) walk(item, depth + 1);
      if (Array.isArray(child.args)) for (const arg of child.args) for (const item of arg.content) walk(item, depth + 1);
    }
    walk(tree);
  } catch (e) {
    const err = e as { message?: string; location?: { start: { line: number; column: number } } };
    issues.push({ message: `LaTeX 结构无法解析：${err.message ?? '未知结构'}`, line: err.location?.start.line ?? 1, column: err.location?.start.column ?? 1 });
  }
  if (issues.length) throw new ContentPolicyError(issues.slice(0, 20));
  return [...usedAssets];
}
export function escapeTex(text: string) {
  const escaped: Record<string, string> = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '_': '\\_', '%': '\\%', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };
  return text.replace(/[\\{}$&#_%~^]/g, c => escaped[c]);
}
export function templateLanguages(files: TemplateFiles): string[] {
  return (parseYaml(files['manifest.yaml']) as { languages: string[] }).languages;
}
export function applyAdminStyle(files: TemplateFiles, kind: DocumentKind, style: AdminStyle): TemplateFiles {
  const font = `\\setCJKmainfont{${style.cjkFont}}\n\\setCJKsansfont{Noto Sans CJK SC}\n\\setCJKmonofont{Noto Sans CJK SC}\n\\setmonofont{DejaVu Sans Mono}\n`;
  let source = '';
  if (kind === 'EDITORIAL_BEAMER') {
    source = '\\usetheme{CWNU}\n' + font + '\\setsansfont{DejaVu Sans}\n';
    if (style.palette === 'BLUE') source += '\\definecolor{cwnuBlue}{RGB}{23,113,161}\n\\definecolor{cwnuDeepBlue}{RGB}{0,82,125}\n\\definecolor{cwnuDark}{RGB}{1,14,19}\n\\definecolor{cwnuNavBg}{RGB}{0,82,125}\n\\definecolor{cwnuNavMuted}{RGB}{132,177,207}\n\\definecolor{cwnuBlockBg}{RGB}{232,239,243}\n';
  } else {
    source = '\\setlength{\\hoffset}{0pt}\n\\setlength{\\voffset}{0pt}\n' + `\\geometry{a4paper,margin=${style.marginMm}mm,headheight=14mm,headsep=7mm,footskip=9mm}\n` + font + '\\setmainfont{Latin Modern Roman}\n';
    if (kind === 'STATEMENT' && files['preamble.tex']) {
      // Explicit admin overrides retain the reference's two-line contest header.
      // An untouched archive draft has an empty style.tex and no overrides.
      source = '\\usepackage{geometry}\n\\setlength{\\hoffset}{0pt}\n\\setlength{\\voffset}{0pt}\n' + `\\geometry{a4paper,margin=${style.marginMm}mm,headheight=2cm,headsep=20pt}\n` + font;
      return { ...files, 'style.tex': source };
    }
    if (kind === 'STATEMENT') source += '\\pagestyle{fancy}\n\\fancyhf{}\n\\chead{\\sffamily\\normalsize ProblemForge · 算法竞赛题面}\n\\renewcommand{\\headrulewidth}{.5pt}\n\\renewcommand{\\footrulewidth}{.5pt}\n\\cfoot{\\sffamily Page \\thepage\\ of \\pageref{LastPage}}\n\\setlength{\\parindent}{2em}\n\\setlength{\\parskip}{2ex}\n\\linespread{1.15}\n';
    else source += '\\pagestyle{plain}\n';
  }
  return { ...files, 'style.tex': source };
}
export function validateTemplate(files: TemplateFiles, kind: DocumentKind) {
  const count = Object.keys(files).length;
  if (!count || count > 40 || Object.values(files).reduce((n, f) => n + Buffer.byteLength(f), 0) > 10_000_000) throw new Error('模板包超出 10MB 或文件数限制');
  for (const path of Object.keys(files)) {
    if (!/^[a-zA-Z0-9_\u4e00-\u9fff/-][a-zA-Z0-9_\u4e00-\u9fff/.\-]*\.(tex|sty|cls|def|yaml|json|png|jpg|jpeg)$/.test(path) || path.includes('..') || path.startsWith('/') || path.split('/').some(p => !p)) throw new Error(`模板文件路径或扩展名不允许：${path}`);
    if (/\.(png|jpe?g)$/.test(path)) templateImage(files[path], path);
  }
  if (!files['main.tex'] || !files['manifest.yaml'] || !files['metadata.schema.json'] || !files['preview.tex']) throw new Error('模板必须有 manifest.yaml、metadata.schema.json、main.tex 和 preview.tex');
  const manifest = parseYaml(files['manifest.yaml']) as Record<string, unknown>;
  if (manifest.protocolVersion !== 1 || manifest.kind !== kind || manifest.entry !== 'main.tex' || manifest.profile !== TEX_PROFILE) throw new Error('模板协议、类型、入口或固定构建 profile 不匹配');
  if (!Array.isArray(manifest.languages) || !manifest.languages.includes('zh-CN')) throw new Error('本阶段模板需声明支持 zh-CN');
  if (manifest.single !== true || typeof manifest.contest !== 'boolean') throw new Error('模板必须声明单题和整场支持');
  if (manifest.contest === true && (manifest.bookletEntry !== 'booklet.tex' || !files['booklet.tex'])) throw new Error('整场模板需包含固定 booklet.tex 入口');
  const schema = JSON.parse(files['metadata.schema.json']) as Record<string, unknown>;
  const properties = schema.properties as Record<string, { type?: string; maxLength?: number }>;
  // Safe declarative subset; never compile an arbitrary schema with eval/new Function.
  if (schema.type !== 'object' || schema.additionalProperties !== false || !properties || Object.keys(properties).some(k => !['title', 'author'].includes(k)) ||
    Object.values(properties).some(p => p.type !== 'string' || typeof p.maxLength !== 'number' || p.maxLength > 160)) throw new Error('metadata schema 仅允许受限的 title / author 文本信息');
  if (!files['main.tex'].includes('{{BODY}}') && !(files['main.tex'].includes('\\input{problem.tex}') && files['problem.tex']?.includes('{{BODY}}'))) throw new Error('模板缺少受控 {{BODY}} 插槽');
  const allowed = new Set(['TITLE', 'AUTHOR', 'BODY', 'CONTEST_TITLE', 'CONTEST_STAGE', 'CONTEST_DATE_HEADER', 'CONTEST_DATE_COVER', 'PROBLEM_LIST']);
  for (const [name, value] of Object.entries(files)) if (/\.(tex|sty|cls|def)$/.test(name)) for (const slot of value.matchAll(/\{\{([A-Z_]+)\}\}/g)) if (!allowed.has(slot[1])) throw new Error(`模板包含未知插槽：${slot[1]}`);
  if (files['publication.json']) publicationContext(files);
  validateBody(files['preview.tex'], kind);
}
export function templateImage(encoded: string, name: string): Buffer {
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > 1_500_000 || bytes.toString('base64') !== encoded) throw new Error(`模板图片需为规范 Base64 且不超过 1.5MB：${name}`);
  const png = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  // Some uploaded JPEGs have trailing metadata after EOI. Preserve their bytes.
  const jpg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.indexOf(Buffer.from([255, 217]), 3) >= 0;
  if (!(name.endsWith('.png') ? png : jpg)) throw new Error(`模板图片格式不匹配：${name}`);
  return bytes;
}
function publicationContext(files: TemplateFiles) {
  const defaults = files['publication.json'] ? JSON.parse(files['publication.json']) : { contestTitle: '比赛标题', contestStage: '', dateHeader: '年/月/日', dateCover: '年 月 日' };
  const names = ['contestTitle', 'contestStage', 'dateHeader', 'dateCover'];
  if (Object.keys(defaults).some(k => !names.includes(k)) || names.some(k => typeof defaults[k] !== 'string' || defaults[k].length > 160)) throw new Error('出版预览信息仅允许比赛标题、场次和日期文本');
  return defaults as { contestTitle: string; contestStage: string; dateHeader: string; dateCover: string };
}
export function render(files: TemplateFiles, kind: DocumentKind, body: string, metadata: { title: string; author: string }, assetPaths: string[] = [], mode: 'single' | 'booklet' = 'single') {
  validateTemplate(files, kind);
  validateBody(body, kind, assetPaths);
  const result: Record<string, string> = {};
  for (const [name, source] of Object.entries(files)) {
    if (/\.(tex|sty|cls|def)$/.test(name)) result[name] = source;
  }
  const context = publicationContext(files);
  const values: Record<string, string> = { TITLE: escapeTex(metadata.title), AUTHOR: escapeTex(metadata.author), BODY: '\\input{content.tex}',
    CONTEST_TITLE: escapeTex(context.contestTitle), CONTEST_STAGE: escapeTex(context.contestStage), CONTEST_DATE_HEADER: escapeTex(context.dateHeader), CONTEST_DATE_COVER: escapeTex(context.dateCover),
    PROBLEM_LIST: `A & ${escapeTex(metadata.title)} & 1 s & 256 MB \\\\\n` };
  for (const [name, source] of Object.entries(result)) result[name] = source.replace(/\{\{([A-Z_]+)\}\}/g, (_, k: string) => values[k] ?? `{{${k}}}`);
  if (mode === 'booklet') { if (!result['booklet.tex']) throw new Error('模板未提供题册入口'); result['main.tex'] = result['booklet.tex']; }
  result['content.tex'] = body;
  delete result['preview.tex'];
  return result;
}
