import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config as dotenv } from 'dotenv'; dotenv();
const { config, root } = await import('@problemforge/domain');
const address = `http://127.0.0.1:${config.port}/api`;
const file = await readFile(resolve(root, '.local/bootstrap-admin.txt'), 'utf8');
const adminEmail = file.match(/邮箱：(.*)/)![1].trim(); const adminPassword = file.match(/密码：(.*)/)![1].trim();
class Client {
  cookie = ''; csrf = '';
  async call(path: string, method = 'GET', data?: object, expected = 200) {
    const response = await fetch(address + path, { method, headers: { Origin: config.origin, ...(data ? { 'Content-Type': 'application/json' } : {}), Cookie: this.cookie, 'X-CSRF-Token': this.csrf }, body: data ? JSON.stringify(data) : undefined });
    const result = await response.json(); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    const cookie = response.headers.get('set-cookie'); if (cookie) this.cookie = cookie.split(';')[0];
    return result;
  }
  async login(email: string, password: string) { const result = await this.call('/auth/login', 'POST', { email, password }); this.csrf = result.csrfToken; return result.user; }
}
const administrator = new Client(); const author = new Client(); const outsider = new Client();
const suffix = randomBytes(5).toString('hex'); const password = randomBytes(24).toString('base64url');
await new Client().call('/problems', 'GET', undefined, 401);
await administrator.login(adminEmail, adminPassword);
const a = await administrator.call('/admin/users', 'POST', { email: `author-${suffix}@problemforge.local`, name: '验收出题人', password, role: 'USER' });
const o = await administrator.call('/admin/users', 'POST', { email: `viewer-${suffix}@problemforge.local`, name: '无权限用户', password: password + 'v', role: 'USER' });
await author.login(a.email, password); await outsider.login(o.email, password + 'v');
await author.call('/admin/templates', 'GET', undefined, 403);
await author.call('/admin/templates', 'POST', { name: '不能创建', kind: 'STATEMENT' }, 403);
const created = await author.call('/problems', 'POST', { title: 'A + B · 主链路验证', language: 'zh-CN' });
await outsider.call(`/problems/${created.id}`, 'GET', undefined, 404);
const problem = await author.call(`/problems/${created.id}`);
const document = problem.documents.find((d: any) => d.kind === 'EDITORIAL_DOCUMENT');
const beamer = problem.documents.find((d: any) => d.kind === 'EDITORIAL_BEAMER');
const save = (d: any, body: string, enabled = true) => ({ expectedVersion: d.version, body, enabled, metadata: d.currentRevision.metadata, templateVersionId: d.templateVersionId });
const docBody = '\\section*{算法思路}\n计算 $a+b$，时间复杂度 $O(1)$。';
const beamBody = '\\begin{frame}{算法思路}\n直接求和。\n\\end{frame}';
const d1 = await author.call(`/documents/${document.id}`, 'PUT', save(document, docBody));
const b1 = await author.call(`/documents/${beamer.id}`, 'PUT', save(beamer, beamBody));
await author.call(`/documents/${document.id}`, 'PUT', save(document, '覆盖旧版本'), 409);
await author.call(`/documents/${document.id}`, 'PUT', { ...save(d1, docBody), preamble: '\\usepackage{shellesc}' }, 400);
const b2 = await author.call(`/documents/${beamer.id}`, 'PUT', save(b1, beamBody, false));
await author.call(`/documents/${beamer.id}`, 'PUT', save(b2, beamBody, true));
await author.call('/auth/logout', 'POST'); await author.login(a.email, password);
const reread = await author.call(`/problems/${problem.id}`);
assert.equal(reread.documents.find((d: any) => d.id === document.id).currentRevision.body, docBody);
assert.equal(reread.documents.find((d: any) => d.id === beamer.id).currentRevision.body, beamBody);
const rejected = await fetch(address + `/documents/${document.id}`, { method: 'PUT', headers: { Origin: config.origin, 'Content-Type': 'application/json', Cookie: author.cookie }, body: JSON.stringify(save(d1, docBody)) });
assert.equal(rejected.status, 403);
await mkdir(resolve(root, '.local'), { recursive: true });
await writeFile(resolve(root, '.local/verify-p1.json'), JSON.stringify({ problemId: problem.id, authorEmail: a.email, authorPassword: password, checkedAt: new Date().toISOString(), checks: ['real login and protected endpoint', 'non-admin template read/write denied', 'problem object read denied', 'independent manuscript save after disable/re-enable and re-login', 'version conflict rejected', 'extra preamble field rejected', 'CSRF rejected'] }, null, 2), { mode: 0o600 });
console.log(`PASS P0/P1 targeted HTTP + PostgreSQL flow; fixture problem ${problem.id}. No TeX or Judge verdict was tested here.`);
