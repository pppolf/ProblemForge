import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv'; dotenv();
const { config, root } = await import('@problemforge/domain');
const address = `http://127.0.0.1:${config.port}/api`;
const text = await readFile(resolve(root, '.local/bootstrap-admin.txt'), 'utf8');
let cookie = ''; let csrf = '';
async function call(path: string, method = 'GET', data?: object, expected = 200) {
  const response = await fetch(address + path, { method, headers: { Origin: config.origin, ...(data ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie, 'X-CSRF-Token': csrf }, body: data ? JSON.stringify(data) : undefined });
  const result = await response.json(); assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
  const header = response.headers.get('set-cookie'); if (header) cookie = header.split(';')[0]; return result;
}
const auth = await call('/auth/login', 'POST', { email: text.match(/邮箱：(.*)/)![1].trim(), password: text.match(/密码：(.*)/)![1].trim() }); csrf = auth.csrfToken;
async function waitBuild(id: string) {
  for (let i = 0; i < 50; i++) {
    const b = await call(`/builds/${id}`);
    if (!['QUEUED', 'RUNNING'].includes(b.state)) return b;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`构建 ${id} 未在 100 秒内完成`);
}
const templates = await call('/admin/templates'); const evidence: any[] = [];
const onlyKind = process.argv.find(a => a.startsWith('--kind='))?.slice(7);
if (onlyKind && !['STATEMENT', 'EDITORIAL_DOCUMENT', 'EDITORIAL_BEAMER'].includes(onlyKind)) throw new Error('未知模板类型');
for (const kind of ['STATEMENT', 'EDITORIAL_DOCUMENT', 'EDITORIAL_BEAMER']) {
  if (onlyKind && kind !== onlyKind) continue;
  const template = templates.find((t: any) => t.kind === kind); assert(template, `缺少 ${kind}`);
  const v = template.versions[0];
  if (v.state !== 'PUBLISHED') {
    const validation = await call(`/admin/template-versions/${v.id}/validate`, 'POST'); const result = await waitBuild(validation.id);
    assert.equal(result.state, 'SUCCEEDED', `${kind} 验证失败：${result.log.slice(-12000)}`);
    // The CLI does not claim human preview. Publishing stays in the administrator UI.
    console.log(`PASS real ${kind} template PDF; pending administrator visual confirmation.`);
    evidence.push({ kind, templateVersionId: v.id, validationBuildId: result.id, artifactId: result.artifacts[0].id, bytes: result.artifacts[0].bytes });
  } else evidence.push({ kind, templateVersionId: v.id, validationBuildId: v.validationBuildId });
}
await writeFile(resolve(root, `.local/verify-tex${onlyKind ? '-' + onlyKind.toLowerCase() : ''}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), evidence }, null, 2));
console.log(`${evidence.length} template version(s) checked. New publication requires preview confirmation; no fake status or PDF was created.`);
