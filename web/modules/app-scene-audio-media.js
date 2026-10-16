const MAX_BYTES = 32 * 1024 * 1024;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const error = code => Object.assign(new Error('Cannot read the selected audio resource.'), { errorCode: `scene_audio_audition_${code}` });

// Only registered IDs become URLs. Callers cannot supply a host or file path.
export function createSceneAudioMediaReader({ fetch: fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = 30000 } = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw error('invalid');
  return async function read(resource, { signal } = {}) {
    const id = Object.getOwnPropertyDescriptor(resource || {}, 'resourceId');
    const size = Object.getOwnPropertyDescriptor(resource || {}, 'size');
    if (!id || !Object.hasOwn(id, 'value') || !uuid(id.value) || !size || !Object.hasOwn(size, 'value')
      || !Number.isSafeInteger(size.value) || size.value < 44 || size.value > MAX_BYTES) throw error('invalid');
    const controller = new AbortController(); let timedOut = false, reader = null, complete = false, timer;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    let cancelled;
    const interruption = new Promise((_, reject) => {
      cancelled = () => reject(error(timedOut ? 'timeout' : 'aborted'));
      controller.signal.addEventListener('abort', cancelled, { once: true });
      if (controller.signal.aborted) cancelled();
    });
    interruption.catch(() => {});
    const wait = promise => Promise.race([promise, interruption]);
    timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
    try {
      if (controller.signal.aborted) throw error('aborted');
      const response = await wait(Promise.resolve(fetchImpl(`/asset-files/${id.value}`, { method: 'GET', cache: 'no-store',
        credentials: 'same-origin', redirect: 'error', signal: controller.signal })).then(value => {
        if (controller.signal.aborted) { try { Promise.resolve(value?.body?.cancel()).catch(() => {}); } catch { /* Already closed. */ } }
        return value;
      }));
      if (response?.status !== 200 || response.redirected || !response.body || typeof response.body.getReader !== 'function') {
        try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch { /* Rejected responses own no playback. */ }
        throw error('response');
      }
      reader = response.body.getReader();
      const declared = response.headers?.get('content-length');
      if (declared !== null && declared !== undefined && (!/^(?:0|[1-9]\d*)$/.test(declared) || Number(declared) !== size.value)) throw error('size');
      const bytes = new Uint8Array(size.value); let offset = 0;
      while (true) {
        const { done, value } = await wait(reader.read()); if (done) break;
        if (!(value instanceof Uint8Array) || offset + value.byteLength > size.value || offset + value.byteLength > MAX_BYTES) throw error('size');
        bytes.set(value, offset); offset += value.byteLength;
      }
      if (offset !== size.value) throw error('size');
      if (controller.signal.aborted) throw error(timedOut ? 'timeout' : 'aborted');
      complete = true; return bytes;
    } catch (failure) {
      if (controller.signal.aborted) throw error(timedOut ? 'timeout' : 'aborted');
      throw failure?.errorCode ? failure : error('network');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', cancelled);
      controller.abort();
      if (reader) {
        if (!complete) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Read may already be closed. */ } }
        try { reader.releaseLock(); } catch { /* Pending reads are rejected by cancel. */ }
      }
    }
  };
}

export const readSceneAudioBytes = createSceneAudioMediaReader();
