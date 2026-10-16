import type { ProblemManifest, StoredBlob } from '@problemforge/contracts';
import { stringify as stringifyYaml } from 'yaml';
import { limits, PackageError, safeExportPath } from './archive.ts';
import { digest } from './native.ts';
import { latexToMarkdown, type MarkdownSample } from './markdown.ts';
import { exportTestData } from './test-data.ts';
import type { Issue, PackageResult } from './types.ts';

function safeTitle(title: string) {
  const characters = [...title.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Cs}<>:"/\\|?*]/gu, '_').trim()].slice(0, 80);
  while (characters.join('').length > 80) characters.pop();
  return characters.join('').replace(/[. ]+$/, '') || '题目';
}

export function novaJudgeDirectory(title: string, archiveId = 1, code?: string) {
  if (!Number.isInteger(archiveId) || archiveId < 1 || archiveId > 100) throw new PackageError('包内题目编号必须为 1～100');
  if (code !== undefined && !/^[A-Z][A-Z0-9]{0,7}$/.test(code)) throw new PackageError('比赛题号无效');
  // Numeric prefixes also preserve contest order in NovaJudge's directory sort.
  return safeExportPath(`${code === undefined ? `problem_${archiveId}` : `${String(archiveId).padStart(3, '0')}_${code}`}_${safeTitle(title)}`);
}

type NovaJudgeOptions = { language?: string; comparison?: 'NATIVE' | 'PRESERVE' };

/** IDs are archive-local asset references; the target allocates new problem IDs. */
export async function exportNovaJudgeProblem(
  manifest: ProblemManifest, read: (key: string) => Promise<Buffer>,
  support: { testlib: Buffer; license: Buffer }, options: NovaJudgeOptions & { archiveId?: number; code?: string } = {},
): Promise<PackageResult> {
  const language = options.language ?? (manifest.documents.some(d => d.enabled && d.kind === 'STATEMENT' && d.language === 'zh-CN') ? 'zh-CN' : manifest.documents.find(d => d.enabled && d.kind === 'STATEMENT')?.language);
  const statement = manifest.documents.find(d => d.enabled && d.kind === 'STATEMENT' && d.language === language);
  if (!statement) throw new PackageError(`缺少已启用的 ${language ?? ''} 题面，无法导出 NovaJudge 题目包`);
  const archiveId = options.archiveId ?? 1, directory = novaJudgeDirectory(manifest.meta.title, archiveId, options.code), files = new Map<string, Buffer>();
  const report: Issue[] = [{ area: '导出文件', status: 'MAPPED', message: `${directory}.zip；包含 problem.json、data/ 和题面引用的 assets/。`, fileName: `${directory}.zip` }];
  let total = 0;
  const put = (path: string, bytes: Buffer) => {
    const fullPath = safeExportPath(`${directory}/${path}`); total += bytes.length;
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
      const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error('binary sample');
      return value;
    } catch { throw new PackageError('题面绑定样例不是可展示的 UTF-8 文本，请修正样例后导出'); }
  };
  const samples: MarkdownSample[] = [];
  for (const revisionId of statement.sampleRevisionIds) {
    const sample = manifest.samples.find(s => s.revisionId === revisionId);
    if (!sample?.answer) throw new PackageError('题面绑定的样例版本或示例输出缺失，请重新绑定完整样例');
    samples.push({ input: await sampleText(sample.input), output: await sampleText(sample.answer) });
  }
  const converted = latexToMarkdown(statement.body, { language, samples, statement: true, structuredStatement: true, assetUrl: path => `/api/problems/${archiveId}/${path}` });
  report.push({ area: '题面', status: 'MAPPED', message: `${language} 题面 v${statement.version} 已转换为 sections / samples / hint，保留 Markdown 与数学公式；${converted.samples.length} 组展示样例保留原始空白和顺序。` });
  for (const message of converted.warnings) report.push({ area: '题面', status: 'WARNING', message });
  for (const path of converted.assets) {
    const asset = manifest.assets.find(a => a.path === path);
    if (!asset) throw new PackageError(`题面引用的图片不存在：${path}`);
    put(path, await checked(asset.blob, '图片'));
  }
  if (converted.assets.length) report.push({ area: '图片', status: 'MAPPED', message: `${converted.assets.length} 张引用图片已放入本题 assets/，导入时随包内题号重写正文和提示中的图片链接。` });
  if (manifest.meta.tags.length) report.push({ area: '标签', status: 'WARNING', message: `NovaJudge 当前题包导入协议不读取标签；本地 ${manifest.meta.tags.length} 个标签未包含在此包中。` });
  const data = await exportTestData(manifest, 'NOVAJUDGE', read, support, { novaJudgeNativeComparison: options.comparison !== 'PRESERVE' });
  const config = JSON.parse(data.files.get('problem.yml')!.toString()) as { type: 'default' | 'spj' | 'interactive'; cases: { input: string; output?: string }[]; checker?: string; interactor?: string };
  const { type, ...judgeConfig } = config;
  if (type === 'interactive') for (const testcase of judgeConfig.cases) testcase.output = '/dev/null';
  put('problem.json', Buffer.from(JSON.stringify({
    id: archiveId, title: manifest.meta.title, type, defaultTimeLimit: manifest.judgeSettings.timeLimitMs,
    defaultMemoryLimit: manifest.judgeSettings.memoryLimitMb, sections: converted.sections,
    samples: converted.samples, hint: converted.hint, judgeConfig,
  }, null, 2) + '\n'));
  for (const [path, bytes] of data.files) if (path !== 'problem.yml') put(`data/${path}`, bytes);
  put('data/problem.yml', Buffer.from(stringifyYaml(judgeConfig)));
  report.push(...data.report.filter(r => !['上传位置', '时间与内存'].includes(r.area)).map(r => r.area === '测试数据' ? { ...r, message: r.message.replace('ZIP 根目录', 'data/ 目录').replace('、题面、题解和参考解', '、题解和参考解') } : r));
  report.push({ area: '题型与限制', status: 'MAPPED', message: `导出为 ${type === 'default' ? '传统题（default）' : type === 'spj' ? 'SPJ（spj）' : '交互题（interactive）'}；problem.json 已写入 ${manifest.judgeSettings.timeLimitMs} ms / ${manifest.judgeSettings.memoryLimitMb} MiB。` });
  if (type !== 'default') report.push({ area: '工具编译', status: 'WARNING', message: 'Checker / Interactor 保留固定源码；NovaJudge 使用目标站的 C++ 编译配置和 testlib.h，随包依赖供核对，需在导入后验收。' });
  report.push({ area: '导入位置', status: 'MAPPED', message: `在 NovaJudge 管理后台的“导入题目”上传整个 ZIP。包内 ID ${archiveId} 仅供图片路径重写，导入时由目标站分配新题号；题解、参考解和私有备注不导出。` });
  return { files, report };
}

export async function exportNovaJudgeContest(
  title: string, items: { code: string; manifest: ProblemManifest }[], read: (key: string) => Promise<Buffer>,
  support: { testlib: Buffer; license: Buffer }, options: NovaJudgeOptions = {},
): Promise<PackageResult> {
  if (!items.length || items.length > 100) throw new PackageError('比赛题包需要 1～100 道题目');
  if (new Set(items.map(item => item.code)).size !== items.length) throw new PackageError('比赛题号不能重复');
  const fileName = safeExportPath(`contest_${safeTitle(title)}_NovaJudge.zip`), files = new Map<string, Buffer>();
  const report: Issue[] = [{ area: '导出文件', status: 'MAPPED', message: `${items.length} 道题目合并为一个 ZIP，按比赛编排顺序分文件夹，目录名包含序号、题号和题目名称。`, fileName }];
  let total = 0;
  for (const [index, item] of items.entries()) {
    try {
      const result = await exportNovaJudgeProblem(item.manifest, read, support, { ...options, archiveId: index + 1, code: item.code });
      for (const [path, bytes] of result.files) {
        total += bytes.length;
        if (files.size >= limits.count || total > limits.expanded) throw new PackageError('整场比赛内容超出包大小限制');
        if (files.has(path)) throw new PackageError('比赛题目目录重复');
        files.set(path, bytes);
      }
      report.push(...result.report.filter(issue => !['导出文件', '导入位置'].includes(issue.area)).map(issue => ({ ...issue, area: `${item.code}/${issue.area}` })));
    } catch (error) {
      if (error instanceof PackageError) throw new PackageError(`题号 ${item.code}：${error.message}`);
      throw error;
    }
  }
  report.push({ area: '导入位置', status: 'MAPPED', message: '在 NovaJudge 管理后台的“导入题目”上传整个 ZIP，可批量导入全部题目。包内编号用于排序和图片引用，目标站分配新题号；不会自动创建比赛或设置比赛权限。题解、参考解和私有备注不导出。' });
  return { files, report };
}
