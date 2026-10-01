import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config, root } from '@problemforge/domain';

export class Client {
  cookie = ''; csrf = '';
  constructor(private base=`http://127.0.0.1:${config.port}`,private origin=config.origin){}
  async request(path: string, method = 'GET', data?: object) {
    return fetch(`${this.base}/api${path}`, { method, headers: { Origin: this.origin, ...(data ? { 'Content-Type': 'application/json' } : {}), Cookie: this.cookie, 'X-CSRF-Token': this.csrf }, body: data ? JSON.stringify(data) : undefined });
  }
  async call(path: string, method = 'GET', data?: object, expected = 200) {
    const response = await this.request(path, method, data), result = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    const cookie = response.headers.get('set-cookie'); if (cookie) this.cookie = cookie.split(';')[0]; return result;
  }
  async login(email: string, password: string) { const result = await this.call('/auth/login', 'POST', { email, password }); this.csrf = result.csrfToken; return result.user; }
  async bootstrap() {
    const file = await readFile(resolve(root, '.local/bootstrap-admin.txt'), 'utf8');
    return this.login(file.match(/邮箱：(.*)/)![1].trim(), file.match(/密码：(.*)/)![1].trim());
  }
  async bytes(path: string, expected = 200) {
    const response = await this.request(path); assert.equal(response.status, expected, path); return Buffer.from(await response.arrayBuffer());
  }
  async waitRun(id: string, timeoutMs = 150000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await this.call(`/test-runs/${id}`);
      if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(run.state)) return run;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`任务 ${id} 未在 ${timeoutMs} ms 内完成，未记录为通过`);
  }
}
