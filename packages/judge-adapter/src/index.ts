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
  args: string[]; env: string[]; files: (SandboxFile | { name: string; max: number; pipe?: boolean } | { streamOut: true } | null)[];
  cpuLimit: number; clockLimit: number; memoryLimit: number; stackLimit: number; procLimit: number;
  copyIn: Record<string, SandboxFile>; copyOut?: string[]; copyOutCached?: string[]; copyOutMax: number;
};
export type SandboxPipe = { in: { index: number; fd: number }; out: { index: number; fd: number }; proxy?: boolean; name?: string; max?: number };
export type InteractionStop = { kind: 'IDLE' | 'OUTPUT_LIMIT' | 'EOF' | 'WALL' | 'INTERACTOR_EXIT'; direction?: string; exitCode?: number };
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
    const data = await response.json() as { buildVersion?: string; os?: string; platform?: string };
    // An exact version check prevents accepting a different request/status protocol.
    if (data.buildVersion !== GO_JUDGE_VERSION || data.os !== 'linux') throw new InfrastructureError(`沙箱协议/平台不符，要求 Linux go-judge ${GO_JUDGE_VERSION}`);
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
  // v1.8.5 /stream uses binary frames. Only the trusted Linux relay's control
  // stream is exposed here; author traffic travels through real pipeMapping fds.
  async executeInteractive(cmd: SandboxCommand[], pipeMapping: SandboxPipe[], wallMs: number, signal?: AbortSignal): Promise<{ results: SandboxResult[]; stop?: InteractionStop }> {
    await this.health();
    return new Promise((resolve, reject) => {
      const endpoint = new URL('/stream', this.url); endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${this.authToken}` }, handshakeTimeout: 10000, maxPayload: 8 * 1024 * 1024 });
      let settled = false, stop: InteractionStop | undefined, control = '', grace: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => { if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from([4])); };
      const wall = setTimeout(() => { stop ??= { kind: 'WALL' }; cancel(); }, wallMs);
      const deadline = setTimeout(() => finish(new InfrastructureError('交互沙箱未确认双方终止')), wallMs + 15000);
      function finish(error?: Error, results?: SandboxResult[]) {
        if (settled) return; settled = true; clearTimeout(wall); clearTimeout(deadline); clearTimeout(grace); signal?.removeEventListener('abort', cancel); ws.close();
        if (error) reject(error); else resolve({ results: results!, stop });
      }
      signal?.addEventListener('abort', cancel, { once: true });
      ws.on('open', () => { ws.send(Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify({ cmd, pipeMapping }))])); if (signal?.aborted) cancel(); });
      ws.on('message', raw => {
        const data = Buffer.from(raw as Buffer);
        try {
          if (data[0] === 1) {
            const response = JSON.parse(data.subarray(1).toString());
            if (response.error || response.results?.length !== cmd.length) throw new Error(response.error ?? '交互结果数量错误');
            finish(undefined, response.results);
          } else if (data[0] === 2 && data[1] === 0x21) {
            control += data.subarray(2).toString('utf8');
            if (control.length > 8192) throw new Error('交互控制记录超限');
            let end: number;
            while ((end = control.indexOf('\n')) >= 0) {
              const event = JSON.parse(control.slice(0, end)) as InteractionStop; control = control.slice(end + 1);
              if (event.kind === 'IDLE' || event.kind === 'OUTPUT_LIMIT') { stop ??= event; cancel(); }
              else if (event.kind === 'INTERACTOR_EXIT' && Number.isInteger(event.exitCode) && !grace) {
                // EOF alone is not process termination: the tool may still be
                // calculating its verdict. The private supervisor confirms exit.
                stop ??= event;
                grace = setTimeout(cancel, 50);
              }
            }
          } else throw new Error('未预期的交互控制帧');
        } catch (e) { cancel(); finish(new InfrastructureError(`交互协议失败：${(e as Error).message}`)); }
      });
      ws.on('error', e => finish(new InfrastructureError(`交互连接失败：${e.message}`)));
      ws.on('close', () => { if (!settled) finish(new InfrastructureError('交互连接在双方结果返回前关闭')); });
    });
  }
}
