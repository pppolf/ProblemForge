import { fromBuffer, type Entry, type ZipFile } from 'yauzl';

export class ArchiveError extends Error {}
export type ImportedTest = { number: number; input: Buffer; answer: Buffer | null };
// Parse in memory with streaming inflation; no archive path is written to disk.
export async function readTestArchive(bytes: Buffer): Promise<ImportedTest[]> {
  if (bytes.length > 8_000_000) throw new ArchiveError('ZIP 压缩文件不能超过 8MB');
  const zip = await new Promise<ZipFile>((resolve, reject) => fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (err, file) => err ? reject(new ArchiveError(err.message)) : resolve(file!)));
  return new Promise((resolve, reject) => {
    const entries = new Set<string>(); const tests = new Map<number, { input?: Buffer; answer?: Buffer }>();
    let count = 0, total = 0, finished = false;
    const fail = (error: Error) => { if (finished) return; finished = true; zip.close(); reject(error instanceof ArchiveError ? error : new ArchiveError(error.message)); };
    zip.on('error', fail);
    zip.on('entry', async (entry: Entry) => {
      try {
        const path = entry.fileName;
        if (++count > 250 || path.length > 120 || path.includes('\\') || path.startsWith('/') || path.includes(':') || path.split('/').some(p => p === '..' || p === '.')) throw new ArchiveError('ZIP 路径或成员数量超出限制');
        if (entries.has(path)) throw new ArchiveError(`ZIP 有重复成员：${path}`); entries.add(path);
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (mode && mode !== 0x8000 && mode !== 0x4000) throw new ArchiveError('ZIP 不接受链接或特殊文件');
        if (entry.generalPurposeBitFlag & 1) throw new ArchiveError('ZIP 不接受加密成员');
        if (path.endsWith('/')) { if (path !== 'tests/') throw new ArchiveError('仅支持 tests/ 目录'); zip.readEntry(); return; }
        const match = /^(?:tests\/)?([0-9]{1,6})\.(in|ans)$/.exec(path);
        if (!match || Number(match[1]) < 1 || Number(match[1]) > 100000) throw new ArchiveError(`仅支持 [tests/]编号.in 和 编号.ans：${path}`);
        if (entry.uncompressedSize > 1_048_576 || total + entry.uncompressedSize > 16_000_000) throw new ArchiveError('ZIP 解压大小超出限制');
        const stream = await new Promise<NodeJS.ReadableStream>((res, rej) => zip.openReadStream(entry, (err, value) => err ? rej(err) : res(value!)));
        const chunks: Buffer[] = []; let length = 0;
        for await (const chunk of stream as AsyncIterable<Buffer>) {
          length += chunk.length;
          if (length > 1_048_576 || total + length > 16_000_000) throw new ArchiveError('ZIP 实际解压大小超出限制');
          chunks.push(chunk);
        }
        total += length;
        const number = Number(match[1]), test = tests.get(number) ?? {};
        const field = match[2] === 'in' ? 'input' : 'answer';
        if (test[field]) throw new ArchiveError(`ZIP 测试编号重复：${number}`);
        test[field] = Buffer.concat(chunks); tests.set(number, test);
        if (tests.size > 100) throw new ArchiveError('单次最多导入 100 组测试数据');
        zip.readEntry();
      } catch (e) { fail(e as Error); }
    });
    zip.on('end', () => {
      if (finished) return;
      if (!tests.size || [...tests.values()].some(t => !t.input)) { fail(new ArchiveError('ZIP 不能为空，每个答案都必须有对应输入')); return; }
      finished = true; zip.close();
      resolve([...tests].sort(([a], [b]) => a - b).map(([number, test]) => ({ number, input: test.input!, answer: test.answer ?? null })));
    });
    zip.readEntry();
  });
}
