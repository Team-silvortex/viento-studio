import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createExecutionToolStatus } from '../../engine/execution-tool-status.mjs';

export const EXECUTION_TOOL_PROBE_TIMEOUT_MS = 12000;
const candidate = (supported, available, reason, candidateKey = null) => Object.freeze({ supported, available, reason, candidateKey });
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0');

// No process is started here. The opaque key includes resolved identity and
// file metadata; it is for this host session, never for the browser DTO.
export async function readExecutionToolCandidate(adapter, { toolPath, enabled = true, platform = process.platform } = {}) {
  const available = await adapter.availability({ toolPath, enabled, platform });
  if (!available.supported) return candidate(false, false, 'platform_unsupported');
  if (!available.available || !absolute(toolPath)) return candidate(true, false, 'tool_missing');
  try {
    const realpath = await fs.realpath(toolPath);
    const stat = await fs.stat(realpath, { bigint: true });
    await fs.access(realpath, constants.X_OK);
    if (!stat.isFile()) return candidate(true, false, 'tool_missing');
    const identity = [realpath, ...['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode'].map(key => String(stat[key]))];
    const candidateKey = `sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
    return candidate(true, true, null, candidateKey);
  } catch { return candidate(true, false, 'tool_missing'); }
}

const reasonForError = error => ({
  build_platform_unsupported: 'platform_unsupported', build_tool_required: 'tool_missing', build_tool_unavailable: 'tool_missing',
  build_tool_version: 'tool_version', build_tool_timeout: 'tool_timeout', 'build_tool_output-limit': 'tool_output_limit',
  build_tool_output_limit: 'tool_output_limit', build_tool_cancelled: 'tool_cancelled', build_input_changed: 'tool_changed',
})[error?.errorCode] || 'tool_failed';

// The trusted adapter remains the single authority for version compatibility.
// Abort covers file identity and process lifetime; we await its cleanup rather
// than leaving a losing Promise.race process running after a timeout.
export async function probeExecutionTool(adapter, { toolPath, enabled = true, platform = process.platform,
  signal, timeoutMs = EXECUTION_TOOL_PROBE_TIMEOUT_MS } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > EXECUTION_TOOL_PROBE_TIMEOUT_MS) {
    throw Object.assign(new TypeError('Invalid tool probe timeout.'), { errorCode: 'build_tool_status_invalid' });
  }
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  let timedOut = false, candidateKey = null;
  const timeout = () => { if (!controller.signal.aborted) { timedOut = true; controller.abort(); } };
  const timer = setTimeout(timeout, timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const interrupted = () => {
    if (!controller.signal.aborted && Date.now() >= deadline) timeout();
    return controller.signal.aborted ? timedOut ? 'tool_timeout' : 'tool_cancelled' : null;
  };
  const result = (reason, identity = null) => Object.freeze({ toolStatus: createExecutionToolStatus({
    backendId: adapter.descriptor.id, status: reason ? 'unavailable' : 'ready', reason, identity,
  }), candidateKey });
  try {
    if (interrupted()) return result(interrupted());
    const before = await readExecutionToolCandidate(adapter, { toolPath, enabled, platform });
    candidateKey = before.candidateKey;
    if (interrupted()) return result(interrupted());
    if (!before.available) return result(before.reason);
    let identified, error;
    try { identified = await adapter.identify(toolPath, { signal: controller.signal }); }
    catch (caught) { error = caught; }
    if (interrupted()) return result(interrupted());
    const after = await readExecutionToolCandidate(adapter, { toolPath, enabled, platform });
    candidateKey = after.candidateKey;
    if (interrupted()) return result(interrupted());
    if (!after.available || before.candidateKey !== after.candidateKey) return result('tool_changed');
    if (error) return result(reasonForError(error));
    // Pick only admitted public identity fields. Executable and diagnostic
    // properties from identify are never spread into transport data.
    return result(null, { version: identified?.version, sha256: identified?.sha256,
      platform: identified?.platform, arch: identified?.arch });
  } catch (error) {
    return result(interrupted() || reasonForError(error));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
