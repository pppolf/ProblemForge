export type TemplateFiles = Record<string, string>;
export const templateFileAccept = '.tex,.sty,.cls,.def,.yaml,.json,.png,.jpg,.jpeg';
export const requiredTemplateFiles = new Set(['main.tex', 'manifest.yaml', 'metadata.schema.json', 'preview.tex']);
export const isTemplateImage = (path: string) => /\.(png|jpe?g)$/.test(path);
export const templateImageType = (path: string) => path.endsWith('.png') ? 'image/png' : 'image/jpeg';
export const fileFolder = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
export const fileBasename = (path: string) => path.split('/').at(-1)!;
const encoder = new TextEncoder();

export function checkTemplatePath(path: string) {
  if (path.length > 160 || !/^[a-zA-Z0-9_\u4e00-\u9fff/-][a-zA-Z0-9_\u4e00-\u9fff/.\-]*\.(tex|sty|cls|def|yaml|json|png|jpg|jpeg)$/.test(path) || path.includes('..') || path.startsWith('/') || path.split('/').some(p => !p)) {
    throw new Error(`文件路径不支持：${path}。请使用中文、字母、数字、下划线或短横线，以及支持的扩展名。`);
  }
}
export function checkTemplateFiles(files: unknown): asserts files is TemplateFiles {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('模板文件必须是路径与内容组成的对象');
  const entries = Object.entries(files);
  if (!entries.length || entries.length > 40) throw new Error('模板最多保存 40 个文件');
  let total = 0;
  for (const [path, value] of entries) {
    checkTemplatePath(path);
    if (typeof value !== 'string' || value.length > 2_000_000) throw new Error(`文件内容超过限制：${path}`);
    total += encoder.encode(value).byteLength;
    if (entries.some(([other]) => other !== path && other.startsWith(path + '/'))) throw new Error(`文件与文件夹路径冲突：${path}`);
    if (isTemplateImage(path)) {
      let raw: string;
      try { raw = atob(value); } catch { throw new Error(`图片内容不是有效 Base64：${path}`); }
      if (raw.length > 1_500_000 || btoa(raw) !== value) throw new Error(`图片不能超过 1.5MB：${path}`);
      const png = raw.startsWith('\x89PNG\r\n\x1a\n');
      const jpeg = raw.startsWith('\xff\xd8\xff') && raw.indexOf('\xff\xd9', 3) >= 0;
      if (!(path.endsWith('.png') ? png : jpeg)) throw new Error(`图片格式与 ${path} 不一致；替换时请选择相同格式的图片`);
    }
  }
  if (total > 10_000_000) throw new Error('模板文件总大小不能超过 10MB');
}
export function importTemplateFiles(current: TemplateFiles, incoming: TemplateFiles) {
  const result = { ...current, ...incoming };
  checkTemplateFiles(result);
  return result;
}
export function moveTemplateFile(files: TemplateFiles, from: string, to: string) {
  if (!Object.hasOwn(files, from)) throw new Error('文件已不存在');
  if (requiredTemplateFiles.has(from) && from !== to) throw new Error('模板入口文件不能重命名');
  if (from === to) return files;
  if (isTemplateImage(from) !== isTemplateImage(to)) throw new Error('重命名不能改变文件的图片或文本类型');
  if (Object.hasOwn(files, to)) throw new Error('目标路径已存在，请换一个名称');
  const result = { ...files, [to]: files[from] };
  delete result[from]; checkTemplateFiles(result); return result;
}
export function removeTemplateFile(files: TemplateFiles, path: string) {
  if (requiredTemplateFiles.has(path)) throw new Error('模板入口文件不能删除');
  const result = { ...files }; delete result[path]; return result;
}
export function uploadTemplatePath(name: string, folder = '') {
  const normalized = name.replace(/\.[^.]+$/, extension => extension.toLowerCase());
  const path = folder ? `${folder}/${normalized}` : normalized;
  checkTemplatePath(path); return path;
}
export async function readTemplateUploads(uploads: File[], folder = '', replacement?: string): Promise<TemplateFiles> {
  if (!uploads.length || uploads.length > 40 || (replacement && uploads.length !== 1)) throw new Error('请选择 1—40 个文件，替换时只能选择一个');
  const entries: [string, string][] = [];
  for (const file of uploads) {
    const path = replacement ?? uploadTemplatePath(file.name, folder);
    checkTemplatePath(path);
    if (entries.some(([other]) => other === path)) throw new Error(`本次上传有重名文件：${path}`);
    if (file.size > (isTemplateImage(path) ? 1_500_000 : 2_000_000)) throw new Error(`文件过大：${file.name}（图片最多 1.5MB，文本最多 2MB）`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let value = '';
    if (isTemplateImage(path)) {
      for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      value = btoa(value);
    } else {
      try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error(`文本必须使用 UTF-8 编码：${file.name}`); }
    }
    entries.push([path, value]);
  }
  const result = Object.fromEntries(entries); checkTemplateFiles(result); return result;
}
export type TemplateTreeNode = { key: string; label: string; path: string; isLeaf: boolean; children?: TemplateTreeNode[] };
export function templateFileTree(files: TemplateFiles): TemplateTreeNode[] {
  const roots: TemplateTreeNode[] = [];
  for (const path of Object.keys(files).sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
    let level = roots; const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
      const folder = i < parts.length - 1, fullPath = parts.slice(0, i + 1).join('/'), key = `${folder ? 'folder' : 'file'}:${fullPath}`;
      let node = level.find(item => item.key === key);
      if (!node) { node = { key, label: parts[i], path: fullPath, isLeaf: !folder, ...(folder ? { children: [] } : {}) }; level.push(node); }
      if (folder) level = node.children!;
    }
  }
  const sort = (nodes: TemplateTreeNode[]) => { nodes.sort((a, b) => Number(a.isLeaf) - Number(b.isLeaf) || a.label.localeCompare(b.label, 'zh-CN')); nodes.forEach(node => node.children && sort(node.children)); };
  sort(roots); return roots;
}
export function templateFileChanges(files: TemplateFiles, original: TemplateFiles) {
  return new Set([...Object.keys(files), ...Object.keys(original)].filter(path => files[path] !== original[path]));
}
