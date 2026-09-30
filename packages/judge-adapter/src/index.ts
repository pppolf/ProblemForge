import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

export const GO_JUDGE_VERSION = 'v1.8.5';
export type SandboxFile = { content: string } | { fileId: string };
export type SandboxResult = {
  status: string; exitStatus: number; time: number; memory: number; runTime: number;
  error?: string; files?: Record<string, string>; fileIds?: Record<string, string>;
  fileError?: { name: string; type: string; message?: string }[];
};
export type SandboxCommand = {
  args: string[]; env: string[]; files: ({ content: string } | { name: string; max: number; pipe?: boolean } | null)[];
  cpuLimit: number; clockLimit: number; memoryLimit: number; stackLimit: number; procLimit: number;
  copyIn: Record<string, SandboxFile>; copyOut?: string[]; copyOutCached?: string[]; copyOutMax: number;
};
export class InfrastructureError extends Error { readonly code = 'SANDBOX_UNAVAILABLE'; }
export class SandboxClient {
  constructor(private url: string, private authToken: string) {}
  private async request(path: string, init: RequestInit = {}) {
    try {
      const response = await fetch(`${this.url}${path}`, {
        ...init, headers: { Authorization: `Bearer ${this.authToken}`, ...init.headers },
        signal: init.signal ?? AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (e) { throw new InfrastructureError(`Linux 沙箱服务不可用：${(e as Error).message}。任务没有在宿主机执行。`); }
  }
  async health() {
    const response = await this.request('/version');
    const data = await response.json() as { buildVersion?: string; version?: string; goos?: string; platform?: string };
    // An exact version check prevents accepting a different request/status protocol.
    const serialized = JSON.stringify(data);
    if (!serialized.includes(GO_JUDGE_VERSION) || !serialized.includes('linux')) throw new InfrastructureError(`沙箱协议/平台不符，要求 Linux go-judge ${GO_JUDGE_VERSION}`);
    return data;
  }
  async upload(name: string, bytes: Buffer) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)]), name);
    const response = await this.request('/file', { method: 'POST', body: form });
    return await response.json() as string;
  }
  async download(id: string) { return Buffer.from(await (await this.request(`/file/${encodeURIComponent(id)}`)).arrayBuffer()); }
  async delete(id: string) { await this.request(`/file/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async execute(command: SandboxCommand, signal?: AbortSignal): Promise<SandboxResult[]> {
    await this.health();
    return new Promise((resolve, reject) => {
      const endpoint = new URL('/ws', this.url); endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${this.authToken}` }, handshakeTimeout: 10000, maxPayload: 8 * 1024 * 1024 });
      const requestId = randomUUID(); let settled = false; let canceled = false;
      const timer = setTimeout(() => finish(new InfrastructureError('沙箱超出协议响应时限')), Math.ceil(command.clockLimit / 1e6) + 15000);
      const cancel = () => {
        canceled = true;
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ cancelRequestId: requestId }));
      };
      function finish(error?: Error, result?: SandboxResult[]) {
        if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        ws.close(); if (error) reject(error); else resolve(result!);
      }
      signal?.addEventListener('abort', cancel, { once: true });
      ws.on('open', () => {
        ws.send(JSON.stringify({ requestId, cmd: [command] }));
        if (signal?.aborted || canceled) cancel();
      });
      ws.on('message', data => {
        try {
          const reply = JSON.parse(data.toString()) as { requestId: string; results?: SandboxResult[]; error?: string };
          if (reply.requestId !== requestId) return;
          if (reply.error || !reply.results?.length) finish(new InfrastructureError(reply.error ?? '沙箱没有返回执行结果'));
          else finish(undefined, reply.results);
        } catch { finish(new InfrastructureError('沙箱返回了无效的协议响应')); }
      });
      ws.on('error', error => finish(new InfrastructureError(`沙箱连接失败：${error.message}`)));
      ws.on('close', () => { if (!settled) finish(new InfrastructureError('沙箱连接在结果返回前关闭')); });
    });
  }
}
