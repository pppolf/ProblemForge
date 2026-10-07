import type { ProblemManifest, StoredBlob } from '@problemforge/contracts';
import { stringify as stringifyYaml } from 'yaml';
import { limits, PackageError, safeExportPath } from './archive.ts';
import { digest } from './native.ts';
import { latexToMarkdown, type MarkdownSample } from './markdown.ts';
import { exportTestData } from './test-data.ts';
import type { Issue, PackageResult } from './types.ts';

export function novaJudgeDirectory(title: string) {
  const characters = [...title.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Cs}<>:"/\\|?*]/gu, '_').trim()].slice(0, 80);
  while (characters.join('').length > 80) characters.pop();
  return safeExportPath(`problem_1_${characters.join('').replace(/[. ]+$/, '') || '题目'}`);
}

/** One problem per ZIP. ID 1 is an archive-local asset reference, not a target ID. */
export async function exportNovaJudgeProblem(
  manifest: ProblemManifest, read: (key: string) => Promise<Buffer>,
  support: { testlib: Buffer; license: Buffer }, options: { language?: string; comparison?: 'NATIVE' | 'PRESERVE' } = {},
): Promise<PackageResult> {
  const language = options.language ?? (manifest.documents.some(d => d.enabled && d.kind === 'STATEMENT' && d.language === 'zh-CN') ? 'zh-CN' : manifest.documents.find(d => d.enabled && d.kind === 'STATEMENT')?.language);
  const statement = manifest.documents.find(d => d.enabled && d.kind === 'STATEMENT' && d.language === language);
  if (!statement) throw new PackageError(`缺少已启用的 ${language ?? ''} 题面，无法导出 NovaJudge 题目包`);
  const directory = novaJudgeDirectory(manifest.meta.title), files = new Map<string, Buffer>();
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
  const converted = latexToMarkdown(statement.body, { language, samples, statement: true, structuredStatement: true, assetUrl: path => `/api/problems/1/${path}` });
  report.push({ area: '题面', status: 'MAPPED', message: `${language} 题面 v${statement.version} 已转换为 sections / samples / hint，保留 Markdown 与数学公式；${converted.samples.length} 组展示样例保留原始空白和顺序。` });
  for (const message of converted.warnings) report.push({ area: '题面', status: 'WARNING', message });
  for (const path of converted.assets) {
    const asset = manifest.assets.find(a => a.path === path);
    if (!asset) throw new PackageError(`题面引用的图片不存在：${path}`);
    put(path, await checked(asset.blob, '图片'));
  }
  const data = await exportTestData(manifest, 'NOVAJUDGE', read, support, { novaJudgeNativeComparison: options.comparison !== 'PRESERVE' });
  const config = JSON.parse(data.files.get('problem.yml')!.toString()) as { type: 'default' | 'spj' | 'interactive'; cases: { input: string; output?: string }[]; checker?: string; interactor?: string };
  const { type, ...judgeConfig } = config;
  if (type === 'interactive') for (const testcase of judgeConfig.cases) testcase.output = '/dev/null';
  put('problem.json', Buffer.from(JSON.stringify({
    id: 1, title: manifest.meta.title, type, defaultTimeLimit: manifest.judgeSettings.timeLimitMs,
    defaultMemoryLimit: manifest.judgeSettings.memoryLimitMb, sections: converted.sections,
    samples: converted.samples, hint: converted.hint, judgeConfig,
  }, null, 2) + '\n'));
  for (const [path, bytes] of data.files) if (path !== 'problem.yml') put(`data/${path}`, bytes);
  put('data/problem.yml', Buffer.from(stringifyYaml(judgeConfig)));
  report.push(...data.report.filter(r => !['上传位置', '时间与内存'].includes(r.area)).map(r => r.area === '测试数据' ? { ...r, message: r.message.replace('ZIP 根目录', 'data/ 目录').replace('、题面、题解和参考解', '、题解和参考解') } : r));
  report.push({ area: '题型与限制', status: 'MAPPED', message: `导出为 ${type === 'default' ? '传统题（default）' : type === 'spj' ? 'SPJ（spj）' : '交互题（interactive）'}；problem.json 已写入 ${manifest.judgeSettings.timeLimitMs} ms / ${manifest.judgeSettings.memoryLimitMb} MiB。` });
  if (type !== 'default') report.push({ area: '工具编译', status: 'WARNING', message: 'Checker / Interactor 保留固定源码；NovaJudge 使用目标站的 C++ 编译配置和 testlib.h，随包依赖供核对，需在导入后验收。' });
  report.push({ area: '导入位置', status: 'MAPPED', message: '在 NovaJudge 管理后台的“导入题目”上传整个 ZIP。包内 ID 1 仅供图片路径重写，导入时由目标站分配新题号；题解、参考解和私有备注不导出。' });
  return { files, report };
}
