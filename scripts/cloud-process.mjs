import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

// A Compose build launches CLI plugins. Cancel its own process group, and wait
// for the command to close before releasing the deployment lock.
export const runCloudCommand = (bin, argv, options = {}) => new Promise((ok, fail) => {
  const grouped = options.processGroup === true && process.platform === 'linux';
  const child = spawn(bin, argv, { cwd: options.cwd, env: options.env, detached: grouped,
    stdio: ['ignore', options.capture || options.output ? 'pipe' : 'inherit', 'inherit'] });
  let text = '', length = 0, stream, failure, killTimer, closed = false;
  const signalChild = signal => {
    if (!child.pid) return;
    try { if (grouped) process.kill(-child.pid, signal); else child.kill(signal); }
    catch (error) { if (error.code !== 'ESRCH') failure ??= error; }
  };
  const abort = error => {
    if (closed || failure) return;
    failure = error;
    signalChild('SIGTERM');
    killTimer = setTimeout(() => signalChild('SIGKILL'), options.killAfterMs ?? 5000);
  };
  const interrupted = () => abort(new Error('构建已中止，正在取消本次构建进程。'));
  const timeout = setTimeout(() => abort(new Error(`${bin} 执行超时，已取消本次命令。`)), options.timeout ?? 1800_000);
  const cleanup = () => {
    closed = true;
    clearTimeout(timeout); clearTimeout(killTimer);
    if (grouped) { process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted); }
  };
  if (grouped) { process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted); }
  if (options.output) {
    stream = createWriteStream(options.output, { flags: 'wx', mode: 0o600 });
    stream.on('error', error => { if (closed) failure ??= error; else abort(error); }); child.stdout.pipe(stream);
  } else if (options.capture) child.stdout.on('data', chunk => {
    length += chunk.length;
    if (length > 16_000_000) abort(new Error('命令输出过大'));
    else text += chunk;
  });
  child.on('error', error => { cleanup(); stream?.destroy(); fail(error); });
  child.on('close', async code => {
    // The CLI parent can exit before a plugin which ignores SIGTERM.
    if (failure && grouped) signalChild('SIGKILL');
    cleanup();
    if (stream && !stream.writableFinished && !stream.destroyed) await new Promise(r => { stream.once('finish', r); stream.once('error', r); });
    if (failure) fail(failure);
    else if (code !== 0 && !options.allowFailure) fail(new Error(`${bin} 执行失败（${code ?? '进程被终止'}）`));
    else ok(options.allowFailure ? { code: code ?? 1, text: text.trim() } : text.trim());
  });
});
