import type { ManifestDocument, ProblemManifest, StoredBlob } from '@problemforge/contracts';
import { limits, PackageError, safeExportPath } from './archive.ts';
import { digest } from './native.ts';
import { escapeMarkdown, latexToMarkdown, type MarkdownSample } from './markdown.ts';
import { exportTestData } from './test-data.ts';
import type { Issue, PackageResult } from './types.ts';

export function hydroDirectory(title: string, date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  const characters = [...title.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Cs}<>:"/\\|?*]/gu, '_').trim()].slice(0, 80);
  // Leave room for nested filenames even when the title uses surrogate pairs.
  while (characters.join('').length > 80) characters.pop();
  const name = characters.join('').replace(/[. ]+$/, '') || '题目';
  return safeExportPath(`${name}_${part('year')}-${part('month')}-${part('day')}_${part('hour')}-${part('minute')}-${part('second')}`);
}

export async function exportHydroProblem(
  manifest: ProblemManifest, read: (key: string) => Promise<Buffer>,
  support: { testlib: Buffer; license: Buffer }, options: { language?: string; exportedAt?: Date } = {},
): Promise<PackageResult> {
  const language = options.language ?? (manifest.documents.some(d => d.enabled && d.kind === 'STATEMENT' && d.language === 'zh-CN') ? 'zh-CN' : manifest.documents.find(d => d.enabled && d.kind === 'STATEMENT')?.language);
  const statement = manifest.documents.find(d => d.kind === 'STATEMENT' && d.language === language && d.enabled);
  if (!statement) throw new PackageError(`缺少已启用的 ${language ?? ''} 题面，无法导出 Hydro 题目包`);
  const editorial = manifest.documents.find(d => d.kind === 'EDITORIAL_DOCUMENT' && d.language === language && d.enabled);
  const directory = hydroDirectory(manifest.meta.title, options.exportedAt ?? new Date());
  const report: Issue[] = [{ area: '导出文件', status: 'MAPPED', message: `${directory}.zip；顶层目录为题目名称_导出时间（北京时间）。`, fileName: `${directory}.zip` }];
  const files = new Map<string, Buffer>(); let total = 0;
  const put = (path: string, bytes: Buffer) => {
    const fullPath = safeExportPath(`${directory}/${path}`);
    total += bytes.length;
    if (files.size >= limits.count || bytes.length > limits.entry || total > limits.expanded) throw new PackageError('导出内容超出包大小限制');
    if (files.has(fullPath)) throw new PackageError(`导出文件重复：${path}`);
    files.set(fullPath, bytes);
  };
  const checked = async (blob: StoredBlob, description: string) => {
    if (blob.bytes > limits.entry) throw new PackageError(`${description}超出单文件大小限制`);
    const bytes = await read(blob.key);
    if (bytes.length !== blob.bytes || digest(bytes) !== blob.hash) throw new PackageError(`${description}字节或 SHA-256 校验失败`);
    return bytes;
  };
  const sampleText = async (blob: StoredBlob) => {
    const bytes = await checked(blob, '题面绑定样例');
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new Error('binary sample');
      return text;
    } catch { throw new PackageError('题面绑定样例不是可展示的 UTF-8 文本，请修正样例后导出'); }
  };
  const samples: MarkdownSample[] = [], english = language?.startsWith('en');
  for (const revisionId of statement.sampleRevisionIds) {
    const sample = manifest.samples.find(s => s.revisionId === revisionId);
    if (!sample || !sample.answer) throw new PackageError('题面绑定的样例版本或示例输出缺失，请重新绑定完整样例');
    samples.push({ input: await sampleText(sample.input), output: await sampleText(sample.answer) });
  }
  const referencedAssets = new Set<string>();
  const document = (doc: ManifestDocument, filename: string, samples?: MarkdownSample[]) => {
    const converted = latexToMarkdown(doc.body, { language, samples, statement: doc.kind === 'STATEMENT' });
    for (const path of converted.assets) referencedAssets.add(path);
    const heading = doc.kind === 'STATEMENT' ? '' : `# ${escapeMarkdown((doc.metadata.title || manifest.meta.title).replace(/[\r\n]+/g, ' '))}\n\n`;
    put(filename, Buffer.from(heading + converted.markdown));
    report.push({ area: filename, status: 'MAPPED', message: `${language} ${doc.kind === 'STATEMENT' ? '题面' : '文档题解'} v${doc.version} 已转成 Markdown，数学公式保留 $…$ / $$…$$。` });
    for (const warning of converted.warnings) report.push({ area: filename, status: 'WARNING', message: warning });
  };
  document(statement, 'statement.md', samples);
  if (editorial) document(editorial, '题解.md');
  else {
    put('题解.md', Buffer.from(`# ${escapeMarkdown(manifest.meta.title.replace(/[\r\n]+/g, ' '))}\n\n${english ? 'No enabled document editorial is available for this language.' : '当前语言尚无已启用的文档题解。'}\n`));
    report.push({ area: '题解.md', status: 'WARNING', message: `${language} 文档题解缺失或已停用，文件中已注明；请保存并启用文档题解后重新导出。` });
  }
  if (samples.length) report.push({ area: '题面样例', status: 'MAPPED', message: `${samples.length} 组绑定样例按固定版本写入 inputN / outputN 代码块，保留输入/输出的空格、换行和顺序。` });
  for (const path of referencedAssets) {
    const asset = manifest.assets.find(a => a.path === path);
    if (!asset) throw new PackageError(`题面或题解引用的图片不存在：${path}`);
    put(path, await checked(asset.blob, '图片'));
  }
  if (referencedAssets.size) report.push({ area: '图片', status: 'MAPPED', message: `${referencedAssets.size} 张引用图片已放入 assets/，Markdown 使用相对路径。` });
  const data = await exportTestData(manifest, 'HYDRO', read, support);
  for (const [path, bytes] of data.files) put(`tests/${path}`, bytes);
  report.push(...data.report.filter(r => r.area !== '上传位置').map(r => r.area === '测试数据' ? { ...r, message: r.message.replace('ZIP 根目录', 'tests/ 目录').replace('、题面、题解和参考解', '和参考解') } : r));
  report.push({ area: '目录结构', status: 'MAPPED', message: 'statement.md 为题面，题解.md 为文档题解；tests/ 包含测试输入、普通题答案、所需 Checker / Interactor、config.yaml 和工具依赖。' });
  report.push({ area: '使用说明', status: 'MAPPED', message: '按此目录解压，分别使用 Markdown 题面和题解；在 Hydro 的题目测试数据管理中上传 tests/ 内的文件（或仅将其内容另打成 ZIP）。' });
  return { files, report };
}
