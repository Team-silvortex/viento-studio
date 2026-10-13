// Logical textarea coordinates use UTF-16 offsets and normalized LF text.
// Visual wrapping, grapheme widths and file serialization belong to callers.
const maximumLength = 4 * 1024 * 1024;
const invalid = () => {
  throw Object.assign(new TypeError('Invalid normalized source position request.'), {
    errorCode: 'source_position_invalid',
  });
};

function lineIndex(length, firstContentOffset, starts) {
  const lineCount = starts.length;
  return Object.freeze({
    length,
    lineCount,
    position(offset) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > length) invalid();
      // Find the last line start at or before the requested caret offset.
      let low = 0, high = lineCount;
      while (low + 1 < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (starts[middle] <= offset) low = middle;
        else high = middle;
      }
      const start = low === 0 ? firstContentOffset : starts[low];
      return Object.freeze({ line: low + 1, column: Math.max(0, offset - start) + 1 });
    },
    lineRange(line) {
      if (!Number.isSafeInteger(line) || line < 1 || line > lineCount) invalid();
      return Object.freeze({
        start: line === 1 ? firstContentOffset : starts[line - 1],
        end: line < lineCount ? starts[line] - 1 : length,
      });
    },
  });
}

export function createSourceLineIndex(text) {
  // Check the size before scanning or allocating the private line-start table.
  if (typeof text !== 'string' || text.length > maximumLength) invalid();
  let lineCount = 1;
  for (let offset = 0; offset < text.length; offset++) {
    const code = text.charCodeAt(offset);
    if (code === 13) invalid();
    if (code === 10) lineCount++;
  }
  // Two passes bound storage even for a document consisting entirely of LFs;
  // no boxed array, split strings or per-line objects survive construction.
  const starts = new Uint32Array(lineCount);
  for (let offset = 0, line = 1; offset < text.length; offset++) {
    if (text.charCodeAt(offset) === 10) starts[line++] = offset + 1;
  }
  return lineIndex(text.length, text.charCodeAt(0) === 0xfeff ? 1 : 0, starts);
}
