import { parse } from '@unified-latex/unified-latex-util-parse';
import type * as Ast from '@unified-latex/unified-latex-types';
import { parse as parseYaml } from 'yaml';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DocumentKind, AdminStyle } from '@problemforge/contracts';
import { SAMPLE_LAYOUT_PREAMBLE, renderSamplePairs } from './samples.ts';

export const POLICY_VERSION = 'pf-content-4';
export const TEX_PROFILE = 'xelatex-2022-bookworm-v1';
export const SAMPLE_RENDERER_VERSION = 'pf-samples-5';
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
const statementMacros = new Set('InputFile OutputFile Examples Example Note Notes Explanation Explanations Constraints Background Specification Interaction Scoring Illustration Description interactor InteractionStart InteractionQuery InteractionAnswer InteractionNotes InteractionExample exmp mat'.split(' '));
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
    source = `\\usetheme{${files['beamerthemeCWNU.sty']?'CWNU':'Madrid'}}\n` + font + '\\setsansfont{DejaVu Sans}\n';
    if (files['beamerthemeCWNU.sty']&&style.palette === 'BLUE') source += '\\definecolor{cwnuBlue}{RGB}{23,113,161}\n\\definecolor{cwnuDeepBlue}{RGB}{0,82,125}\n\\definecolor{cwnuDark}{RGB}{1,14,19}\n\\definecolor{cwnuNavBg}{RGB}{0,82,125}\n\\definecolor{cwnuNavMuted}{RGB}{132,177,207}\n\\definecolor{cwnuBlockBg}{RGB}{232,239,243}\n';
    if(!files['beamerthemeCWNU.sty'])source+=`\\setbeamercolor{structure}{fg=${style.palette==='BLUE'?'blue':'red'}!55!black}\n\\setbeamertemplate{navigation symbols}{}\n`;
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
  const allowed = new Set(['TITLE', 'AUTHOR', 'BODY', 'CONTEST_TITLE', 'CONTEST_STAGE', 'CONTEST_DATE_HEADER', 'CONTEST_DATE_COVER', 'PROBLEM_LIST','CONTENTS','CODE','TIME_LIMIT','MEMORY_LIMIT','INPUT_FILE','OUTPUT_FILE']);
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
export function printableSample(bytes: Buffer) {
  if (bytes.length > 65536) throw new Error('题面单个样例输入/答案最多 64KiB');
  let value: string; try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('题面样例必须是可显示的 UTF-8 文本，原始测试数据未改变'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error('题面样例包含不能显示的控制字节，原始测试数据未改变');
}
export type SamplePaths = { inputPath: string; answerPath: string };
export const CONTEST_RENDERER_VERSION='pf-contest-2';
export type ContestRenderInput={title:string;author:string;stage:string;dateHeader:string;dateCover:string;entries:{namespace:string;code:string;body:string;metadata:{title:string;author:string};assetPaths:string[];samples:SamplePaths[];timeLimitMs:number;memoryLimitMb:number;inputFile:string;outputFile:string}[]};
export function renderContest(files:TemplateFiles,kind:DocumentKind,input:ContestRenderInput){
  validateTemplate(files,kind);
  if(!files['booklet.tex']?.includes('{{CONTENTS}}')||!files['item.tex']?.includes('{{BODY}}'))throw new Error('整场模板必须提供 booklet.tex 的 CONTENTS 和 item.tex 的 BODY 插槽');
  if(!input.entries.length||input.entries.length>100||new Set(input.entries.map(e=>e.namespace)).size!==input.entries.length)throw new Error('整场题目清单为空、重复或超额');
  const result:Record<string,string>={};
  const context:Record<string,string>={TITLE:escapeTex(input.title),AUTHOR:escapeTex(input.author),CONTEST_TITLE:escapeTex(input.title),CONTEST_STAGE:escapeTex(input.stage),CONTEST_DATE_HEADER:escapeTex(input.dateHeader),CONTEST_DATE_COVER:escapeTex(input.dateCover),BODY:'',CODE:'',TIME_LIMIT:'',MEMORY_LIMIT:'',INPUT_FILE:'',OUTPUT_FILE:'',
    CONTENTS:input.entries.map(e=>`\\input{${e.namespace}/item.tex}`).join('\n'),
    PROBLEM_LIST:input.entries.map(e=>`${escapeTex(e.code)} & ${escapeTex(e.metadata.title)} & ${e.timeLimitMs/1000} s & ${e.memoryLimitMb} MB \\\\`).join('\n'),
  };
  const fill=(source:string,values:Record<string,string>)=>source.replace(/\{\{([A-Z_]+)\}\}/g,(_,k:string)=>values[k]??context[k]??`{{${k}}}`);
  for(const [name,source]of Object.entries(files))if(/\.(tex|sty|cls|def)$/.test(name)&&!['preview.tex','item.tex'].includes(name))result[name]=fill(source,context);
  result['main.tex']=result['booklet.tex'];
  if(input.entries.some(entry=>entry.samples.length))result['main.tex']=SAMPLE_LAYOUT_PREAMBLE+result['main.tex'];
  for(const entry of input.entries){
    if(!/^p[1-9][0-9]*$/.test(entry.namespace)||!/^[A-Z][A-Z0-9]{0,7}$/.test(entry.code))throw new Error('不合法的比赛题目命名空间或题号');
    const single=render(files,kind,entry.body,entry.metadata,entry.assetPaths,'single',entry.samples);
    // Preserve literal code; a label or resource path printed in verbatim is not a reference.
    const literals:string[]=[];
    let body=single['content.tex'].replace(/\\begin\{(verbatim|centerverbatim)\}[\s\S]*?\\end\{\1\}|\\verb\*?([^a-zA-Z\s])[^\r\n]*?\2/g,value=>`\u0000${literals.push(value)-1}\u0000`);
    for(const path of entry.assetPaths)body=body.split(path).join(`${entry.namespace}/${path}`);
    body=body.replace(/\\input\{samples\.tex\}/g,`\\input{${entry.namespace}/samples.tex}`);
    // Local labels remain local when several independently authored texts meet.
    body=body.replace(/\\(label|ref|eqref|pageref)\{([^{}\\]*)\}/g,(_,command:string,key:string)=>`\\${command}{${entry.namespace}:${key}}`);
    result[`${entry.namespace}/content.tex`]=body.replace(/\u0000([0-9]+)\u0000/g,(_,i:string)=>literals[Number(i)]);
    if(single['samples.tex'])result[`${entry.namespace}/samples.tex`]=single['samples.tex'].replace(/\{samples\//g,`{${entry.namespace}/samples/`);
    result[`${entry.namespace}/item.tex`]=fill(files['item.tex'],{TITLE:escapeTex(entry.metadata.title),AUTHOR:escapeTex(entry.metadata.author),BODY:`\\input{${entry.namespace}/content.tex}`,CODE:escapeTex(entry.code),TIME_LIMIT:escapeTex(`${entry.timeLimitMs/1000} s`),MEMORY_LIMIT:escapeTex(`${entry.memoryLimitMb} MB`),INPUT_FILE:escapeTex(entry.inputFile),OUTPUT_FILE:escapeTex(entry.outputFile)});
  }
  return result;
}
export function render(files: TemplateFiles, kind: DocumentKind, body: string, metadata: { title: string; author: string }, assetPaths: string[] = [], mode: 'single' | 'booklet' = 'single', samples: SamplePaths[] = []) {
  validateTemplate(files, kind);
  validateBody(body, kind, assetPaths);
  const result: Record<string, string> = {};
  for (const [name, source] of Object.entries(files)) {
    if (/\.(tex|sty|cls|def)$/.test(name)) result[name] = source;
  }
  const context = publicationContext(files);
  const values: Record<string, string> = { TITLE: escapeTex(metadata.title), AUTHOR: escapeTex(metadata.author), BODY: '\\input{content.tex}',
    CONTENTS: '\\input{problem.tex}', CODE: 'A', TIME_LIMIT: '1 s', MEMORY_LIMIT: '256 MB', INPUT_FILE:'standard input', OUTPUT_FILE:'standard output',
    CONTEST_TITLE: escapeTex(context.contestTitle), CONTEST_STAGE: escapeTex(context.contestStage), CONTEST_DATE_HEADER: escapeTex(context.dateHeader), CONTEST_DATE_COVER: escapeTex(context.dateCover),
    PROBLEM_LIST: `A & ${escapeTex(metadata.title)} & 1 s & 256 MB \\\\\n` };
  for (const [name, source] of Object.entries(result)) result[name] = source.replace(/\{\{([A-Z_]+)\}\}/g, (_, k: string) => values[k] ?? `{{${k}}}`);
  if (mode === 'booklet') { if (!result['booklet.tex']) throw new Error('模板未提供题册入口'); result['main.tex'] = result['booklet.tex']; if(result['item.tex'])result['problem.tex']=result['item.tex']; }
  result['content.tex'] = body;
  if (samples.length) {
    if (kind !== 'STATEMENT' || samples.length > 10 || samples.some(s => !/^samples\/sample-[1-9][0-9]*\.in$/.test(s.inputPath) || !/^samples\/sample-[1-9][0-9]*\.ans$/.test(s.answerPath))) throw new Error('样例文件必须使用平台固定的题面命名空间');
    // Select the template's side-by-side or stacked table from actual font
    // measurements at compile time. Raw bytes remain in literal sample files.
    result['main.tex'] = SAMPLE_LAYOUT_PREAMBLE + result['main.tex'];
    result['samples.tex'] = renderSamplePairs(samples);
    // Insert bound samples before the closing Note section. Only real top-level
    // headings count: comments, literal code and macro arguments stay untouched.
    const note = parse(body).content.find(node => node.type === 'macro' && ['Note', 'Notes'].includes(node.content));
    const sampleOffset = note?.position?.start.offset ?? body.length;
    result['content.tex'] = body.slice(0, sampleOffset) + '\n\\input{samples.tex}\n' + body.slice(sampleOffset);
  }
  delete result['preview.tex'];
  return result;
}
