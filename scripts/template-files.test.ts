import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { checkTemplateFiles, importTemplateFiles, moveTemplateFile, readTemplateUploads, removeTemplateFile, templateFileChanges, templateFileTree, uploadTemplatePath } from '../apps/web/src/template-files.ts';

const png = await readFile('templates/builtin/statement/images/协会logo.png');
const jpg = await readFile('templates/builtin/statement/img.jpg');
const original = { 'main.tex': '\\includegraphics{images/logo.png}', 'images/logo.png': png.toString('base64'), 'old.tex': '% retained until removed' };
test('uploads preserve original PNG/JPEG bytes and UTF-8 source, including Chinese paths', async () => {
  const files = await readTemplateUploads([new File([png], '协会.PNG'), new File([jpg], 'cover.JPG'), new File(['% 中文\r\n'], 'header.tex')], 'images/new');
  assert.deepEqual(Buffer.from(files['images/new/协会.png'], 'base64'), png);
  assert.deepEqual(Buffer.from(files['images/new/cover.jpg'], 'base64'), jpg);
  assert.equal(files['images/new/header.tex'], '% 中文\r\n');
  const merged = importTemplateFiles(original, files);
  assert.equal(merged['main.tex'], original['main.tex']); assert(!Object.hasOwn(original, 'images/new/cover.jpg'));
});
test('replace an image keeps its referenced path even when upload has another name', async () => {
  const other = await readFile('templates/builtin/statement/images/cwnucpc.png');
  const incoming = await readTemplateUploads([new File([other], 'another.png')], '', 'images/logo.png');
  const updated = importTemplateFiles(original, incoming);
  assert.equal(updated['main.tex'], original['main.tex']); assert.equal(updated['images/logo.png'], other.toString('base64'));
  assert.equal(Object.keys(updated).length, Object.keys(original).length);
  assert.deepEqual([...templateFileChanges(updated, original)], ['images/logo.png']);
});
test('rename, delete and restore work on new maps without modifying saved files', () => {
  const renamed = moveTemplateFile(original, 'old.tex', 'sections/new.tex');
  assert.equal(renamed['sections/new.tex'], original['old.tex']); assert(!Object.hasOwn(renamed, 'old.tex'));
  assert.throws(() => moveTemplateFile(original, 'old.tex', 'main.tex'), /已存在/);
  for (const path of ['main.tex', 'manifest.yaml', 'metadata.schema.json', 'preview.tex']) {
    assert.throws(() => moveTemplateFile({ ...original, [path]: 'content' }, path, 'other.tex'), /入口/);
    assert.throws(() => removeTemplateFile(original, path), /入口/);
  }
  assert.throws(() => moveTemplateFile(original, 'images/logo.png', 'logo.tex'), /类型/);
  const removed = removeTemplateFile(renamed, 'images/logo.png');
  assert(original['images/logo.png']); assert(!Object.hasOwn(removed, 'images/logo.png'));
  assert.equal(templateFileChanges({ ...original }, original).size, 0);
});
test('unsafe, unsupported and colliding paths fail before modifying the draft', () => {
  for (const path of ['../main.tex', '/main.tex', 'C:/main.tex', 'images//a.png', 'images\\a.png', 'images/a.svg', 'a name.tex', 'a'.repeat(161) + '.tex']) assert.throws(() => uploadTemplatePath(path));
  assert.throws(() => importTemplateFiles(original, { 'old.tex/child.tex': '' }), /路径冲突/);
  assert.throws(() => checkTemplateFiles(['main.tex']), /对象/);
  assert.throws(() => checkTemplateFiles({ 'main.tex': 42 }), /内容/);
  assert.equal(original['old.tex'], '% retained until removed');
});
test('invalid uploads and mixed-format replacements are rejected as one batch', async () => {
  await assert.rejects(readTemplateUploads([new File([jpg], 'new.jpg')], '', 'images/logo.png'), /格式/);
  await assert.rejects(readTemplateUploads([new File([png], 'ok.png'), new File(['not an image'], 'bad.png')]), /格式/);
  await assert.rejects(readTemplateUploads([new File([new Uint8Array([0xff])], 'bad.tex')]), /UTF-8/);
  await assert.rejects(readTemplateUploads([new File(['a'], 'same.tex'), new File(['b'], 'same.tex')]), /重名/);
  await assert.rejects(readTemplateUploads([new File([new Uint8Array(1_500_001)], 'big.png')]), /1.5MB/);
  assert.throws(() => checkTemplateFiles({ 'a.png': png.toString('base64') + '\n' }), /1.5MB/);
});
test('file-count and byte limits allow replacement but reject overflow', async () => {
  const full = Object.fromEntries(Array.from({ length: 40 }, (_, n) => [`file${n}.tex`, 'a']));
  assert.equal(Object.keys(importTemplateFiles(full, { 'file0.tex': 'replaced' })).length, 40);
  assert.throws(() => importTemplateFiles(full, { 'extra.tex': '' }), /40/);
  assert.throws(() => checkTemplateFiles(Object.fromEntries(Array.from({ length: 6 }, (_, n) => [`f${n}.tex`, 'a'.repeat(1_800_000)]))), /10MB/);
});
test('resource tree keeps nested directories, basename collisions and file markers distinct', () => {
  const files = { 'main.tex': '', 'images/协会.png': png.toString('base64'), 'sections/header.tex': '', 'other/header.tex': '' };
  const tree = templateFileTree(files);
  assert.equal(tree.at(-1)?.path, 'main.tex');
  assert.equal(tree.find(node => node.path === 'sections')?.children?.[0].key, 'file:sections/header.tex');
  assert.equal(tree.find(node => node.path === 'other')?.children?.[0].key, 'file:other/header.tex');
  assert.deepEqual([...templateFileChanges({ 'main.tex': 'new' }, { 'main.tex': '', 'deleted.tex': '' })], ['main.tex', 'deleted.tex']);
});
