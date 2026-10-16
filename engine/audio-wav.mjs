// Container validation at the resource boundary; no transcoding or mutation.
export function validatePcmWave(bytes) {
  const fail = () => { throw Object.assign(new Error('Scene audio requires a complete PCM 16-bit mono/stereo WAV (8–96 kHz).'), { errorCode: 'build_audio_format' }); };
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 44) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.length) fail();
  let format = null, dataSize = null, offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail();
    const size = view.getUint32(offset + 4, true), start = offset + 8, end = start + size;
    if (end > bytes.length) fail();
    if (ascii(offset) === 'fmt ') {
      if (format || size !== 16 || view.getUint16(start, true) !== 1) fail();
      const channels = view.getUint16(start + 2, true), rate = view.getUint32(start + 4, true), alignment = view.getUint16(start + 12, true);
      if (![1, 2].includes(channels) || rate < 8000 || rate > 96000 || alignment !== channels * 2
        || view.getUint16(start + 14, true) !== 16 || view.getUint32(start + 8, true) !== rate * alignment) fail();
      format = { channels, sampleRate: rate, frameBytes: alignment };
    } else if (ascii(offset) === 'data') { if (dataSize !== null || !size) fail(); dataSize = size; }
    offset = end + (size % 2);
  }
  if (offset !== bytes.length || !format || !dataSize || dataSize % format.frameBytes) fail();
  return { ...format, frames: dataSize / format.frameBytes };
}
