import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

// One owner for process lifetime. POSIX children run in their own process group;
// cancellation and timeouts also reap descendants that inherited the pipes.
export function runBuildProcess(executable, args, { cwd, env, signal, timeoutMs = 30000, maxOutputBytes = 1024 * 1024, onOutput, onStart } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw new Error('Invalid process timeout');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 16 * 1024 * 1024) throw new Error('Invalid process output limit');
  return new Promise(resolve => {
    const started = Date.now();
    if (signal?.aborted) { resolve({ status: 'cancelled', exitCode: null, stdout: '', stderr: '', durationMs: 0 }); return; }
    const child = spawn(executable, args, { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let status, stdout = '', stderr = '', size = 0, killTimer;
    let observerFailed = false;
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
    const kill = () => {
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL'); }
    };
    const stop = reason => {
      if (status) return;
      status = reason;
      try {
        if (process.platform === 'win32') child.kill('SIGTERM');
        else process.kill(-child.pid, 'SIGTERM');
      } catch { /* May already have exited; close still drains the pipes. */ }
      killTimer = setTimeout(kill, 300);
    };
    const abort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const observe = (callback, value) => {
      if (observerFailed || !callback) return;
      try { callback(value); }
      catch { observerFailed = true; stop('observer-failed'); }
    };
    const append = (stream, text) => {
      if (!text) return;
      if (stream === 'stdout') stdout += text; else stderr += text;
      observe(onOutput, { stream, text });
    };
    const capture = stream => data => {
      const remaining = Math.max(0, maxOutputBytes - size); size += data.length;
      append(stream, decoders[stream].write(data.subarray(0, remaining)));
      if (size > maxOutputBytes) stop('output-limit');
    };
    child.stdout.on('data', capture('stdout')); child.stderr.on('data', capture('stderr'));
    child.once('spawn', () => observe(onStart, { pid: child.pid }));
    child.on('error', error => { status ||= 'unavailable'; stderr += error.code || 'spawn-error'; });
    child.once('close', (exitCode, exitSignal) => {
      append('stdout', decoders.stdout.end()); append('stderr', decoders.stderr.end());
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
      // The group may still contain a child that closed its inherited pipes.
      if (process.platform !== 'win32' && child.pid) kill();
      resolve({ status: status || (exitCode === 0 ? 'succeeded' : 'failed'), exitCode, exitSignal,
        stdout, stderr, durationMs: Date.now() - started });
    });
  });
}
