import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { config, root } from '@problemforge/domain';

const base = `http://127.0.0.1:${config.port}/api`;
class Client {
  cookie = ''; csrf = '';
  async request(path: string, method = 'GET', data?: object) {
    return fetch(base + path, { method, headers: { Origin: config.origin, ...(data ? { 'Content-Type': 'application/json' } : {}), Cookie: this.cookie, 'X-CSRF-Token': this.csrf }, body: data ? JSON.stringify(data) : undefined });
  }
  async call(path: string, method = 'GET', data?: object, status = 200): Promise<any> {
    const response = await this.request(path, method, data); const result = await response.json();
    assert.equal(response.status, status, `${path}: ${JSON.stringify(result)}`);
    const cookie = response.headers.get('set-cookie'); if (cookie) this.cookie = cookie.split(';')[0]; return result;
  }
  async login(email: string, password: string) { this.csrf = (await this.call('/auth/login', 'POST', { email, password })).csrfToken; }
  async wait(id: string) {
    for (let i = 0; i < 50; i++) { const b = await this.call(`/builds/${id}`); if (!['QUEUED', 'RUNNING'].includes(b.state)) return b; await new Promise(r => setTimeout(r, 2000)); }
    throw new Error(`构建 ${id} 超过 100 秒`);
  }
}
const administrator = new Client(), author = new Client(), anonymous = new Client();
const credentials = await readFile(resolve(root, '.local/bootstrap-admin.txt'), 'utf8');
await administrator.login(credentials.match(/邮箱：(.*)/)![1].trim(), credentials.match(/密码：(.*)/)![1].trim());
const browserProblemId = process.argv[2];
assert(browserProblemId, '请提供通过浏览器编辑并构建的题目 ID');
const browserProblem = await administrator.call(`/problems/${browserProblemId}`);
const browserBuilds = await administrator.call(`/builds?problemId=${browserProblemId}`);
const evidence: any[] = [];
for (const d of browserProblem.documents.filter((d: any) => d.language === 'zh-CN')) {
  const b = browserBuilds.find((b: any) => b.documentId === d.id && b.state === 'SUCCEEDED' && !b.stale);
  assert(b?.artifacts.length, `${d.kind} 缺少浏览器提交的当前成功构建`);
  const r = await administrator.request(`/artifacts/${b.artifacts[0].id}/pdf`);
  assert.equal(r.status, 200); const bytes = Buffer.from(await r.arrayBuffer()); assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  evidence.push({ kind: d.kind, buildId: b.id, artifactId: b.artifacts[0].id, bytes: bytes.length });
}
assert.equal(evidence.length, 3); console.log('PASS browser → API → PostgreSQL → Worker → three real private PDFs.');
const statement = browserProblem.documents.find((d: any) => d.kind === 'STATEMENT');
const statementBuild = evidence.find(b => b.kind === 'STATEMENT');
const publication = await administrator.call(`/documents/${statement.id}/publish`, 'POST', { buildId: statementBuild.buildId });
assert.equal((await anonymous.request(`/published/${publication.token}/pdf`)).status, 200);
const editorial = evidence.find(b => b.kind === 'EDITORIAL_DOCUMENT');
assert.equal((await anonymous.request(`/artifacts/${editorial.artifactId}/pdf`)).status, 401);
await administrator.call(`/publications/${publication.id}/revoke`, 'POST');
assert.equal((await anonymous.request(`/published/${publication.token}/pdf`)).status, 404);
console.log('PASS statement publication keeps editorial private; revoked link no longer downloads.');

const fixture = JSON.parse(await readFile(resolve(root, '.local/verify-p1.json'), 'utf8'));
await author.login(fixture.authorEmail, fixture.authorPassword);
const problem = await author.call(`/problems/${fixture.problemId}`);
const templates = await author.call('/templates'); assert(templates.every((v: any) => !('files' in v) && !('styleConfig' in v)));
const d = problem.documents.find((d: any) => d.kind === 'EDITORIAL_DOCUMENT');
const template = templates.find((v: any) => v.template.kind === d.kind && v.languages.includes(d.language)); assert(template);
// Small deterministic PNG fixture, encoded as bytes; no host resource converter.
function chunk(type: string, data: Buffer) {
  const payload = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
  for (const byte of payload) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const head = Buffer.alloc(4), tail = Buffer.alloc(4); head.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([head, payload, tail]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(32, 0); ihdr.writeUInt32BE(20, 4); ihdr[8] = 8; ihdr[9] = 2;
const rows = Buffer.alloc(20 * (32 * 3 + 1)); for (let y = 0; y < 20; y++) for (let x = 0; x < 32; x++) { const i = y * 97 + 1 + x * 3; rows[i] = 37; rows[i + 1] = 99; rows[i + 2] = 235; }
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
const asset = await author.call(`/problems/${problem.id}/assets`, 'POST', { name: '验收图片.png', base64: png.toString('base64') });
assert.equal((await anonymous.request(`/assets/${asset.id}/file`)).status, 401);
const body = `\\section*{算法思路}\n计算 $a+b$。\n\\includegraphics[width=20mm]{${asset.path}}`;
const save = (doc: any, content: string) => author.call(`/documents/${doc.id}`, 'PUT', { expectedVersion: doc.version, body: content, metadata: doc.currentRevision.metadata, enabled: true, templateVersionId: template.id });
const good = await save(d, body);
const built = await author.wait((await author.call('/builds', 'POST', { documentId: d.id })).id);
assert.equal(built.state, 'SUCCEEDED', built.log); assert(built.artifacts[0].bytes > 1000);
console.log('PASS non-admin selects published template; private PNG travels in hashed sandbox input and compiles.');
const invalid = await save(good, body + '\n\\begin{tabular}{c}a & b\\\\\\end{tabular}');
const failed = await author.wait((await author.call('/builds', 'POST', { documentId: d.id })).id);
assert.equal(failed.state, 'FAILED', failed.log); assert.equal(failed.errorCode, 'TEX_COMPILE_FAILED'); assert.match(failed.log, /Extra alignment tab|Misplaced|alignment/i);
assert.equal((await author.request(`/artifacts/${built.artifacts[0].id}/pdf`)).status, 200);
const after = await author.call(`/problems/${problem.id}`);
assert.equal(after.documents.find((doc: any) => doc.kind === 'EDITORIAL_BEAMER').currentRevision.body, problem.documents.find((doc: any) => doc.kind === 'EDITORIAL_BEAMER').currentRevision.body);
await save(invalid, body);
await author.call(`/problems/${problem.id}/languages`, 'POST', { language: 'en' });
const languages = await author.call(`/problems/${problem.id}`);
assert.equal(languages.documents.filter((doc: any) => doc.language === 'en').length, 3);
assert.equal(languages.documents.find((doc: any) => doc.id === d.id).currentRevision.body, body);
console.log('PASS real TeX error and original logs; previous artifact/other manuscript survive; language drafts stay separate.');
await writeFile(resolve(root, '.local/verify-publication.json'), JSON.stringify({ checkedAt: new Date().toISOString(), browserProblemId, evidence, imageBuildId: built.id, failureBuildId: failed.id, fixtureProblemId: problem.id, publicationRevoked: true }, null, 2));
