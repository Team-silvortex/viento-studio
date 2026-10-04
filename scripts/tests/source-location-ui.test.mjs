import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { sourceLocationSelection } from '../../web/modules/app-source-location.js';
import { deferred, editorHarness } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const digest = source => `sha256:${createHash('sha256').update(source).digest('hex')}`;
const normalize = source => source.replace(/\r\n|\r/g, '\n');
const source = '\uFEFF{\r\n  "title": "旅人😀",\r\n  "actors": [{"speed": 160, "position": [10, 20]}]\r\n}\r\n';
function location(content = source, path = 'documents/scenes/main.json', token = '160', propertyPath = '/actors/0/speed') {
  const start = content.indexOf(token); assert.ok(start >= 0);
  return { objectId: 'scene', sourcePath: path, propertyPath, sourceRevision: digest(content),
    sourceRange: { start, end: start + token.length, encoding: 'utf-16', propertyPath, exact: true } };
}
async function harness(options = {}) {
  const reads = [], writes = [];
  const h = await editorHarness({ readDocSource: async input => {
    reads.push(input); return options.read ? options.read(input) : { content: source, version: '2' };
  }, writeDoc: async input => { writes.push(input); return { version: 'written' }; }, ...(options.crypto ? { crypto: options.crypto } : {}) });
  h.state.workspace = { version: 3, paths: { documents: 'documents' } };
  h.doc.sourcePath = 'documents/scenes/main.json'; h.doc._sourceCachedText = 'old cached text';
  h.runtime.rebuildDocPathCaches(h.state.docs);
  for (const name of ['renderHeroBanner', 'renderSectionCards', 'renderGallery', 'markActiveItem', 'setModeUi']) h.runtime[name] = () => {};
  h.runtime.getHeroImagesForDisplay = () => [];
  h.runtime.logRuntimeErrorOrMessage = (_context, error) => { throw error; };
  const addDoc = () => {
    const doc = { ...h.doc, path: 'scene/other', sourcePath: 'documents/scenes/other.json', _sourceCachedText: 'other cached text' };
    h.state.docs.push(doc); h.runtime.rebuildDocPathCaches(h.state.docs); return doc;
  };
  return { ...h, reads, writes, addDoc };
}
const selected = h => h.source.value.slice(h.source.selectionStart, h.source.selectionEnd);
const flush = () => new Promise(setImmediate);
const opened = result => assert.equal(typeof result?.focus, 'function');

test('exact source selection converts original UTF-16 offsets through BOM, Chinese, emoji and every newline form', () => {
  for (const newline of ['\r\n', '\r', '\n']) {
    const raw = source.replaceAll('\r\n', newline), info = location(raw);
    const result = sourceLocationSelection(raw, info, digest(raw));
    assert.equal(result.status, 'exact'); assert.equal(normalize(raw).slice(result.start, result.end), '160');
    const emoji = location(raw, info.sourcePath, '"旅人😀"', '/title');
    const title = sourceLocationSelection(raw, emoji, digest(raw));
    assert.equal(normalize(raw).slice(title.start, title.end), '"旅人😀"');
    assert.equal(result.start, normalize(raw.slice(0, info.sourceRange.start)).length);
  }
});

test('source selection rejects stale, malformed, ambiguous and split-character ranges without guessing', () => {
  const valid = location();
  assert.deepEqual(sourceLocationSelection(source, valid, digest('changed')), { status: 'stale' });
  for (const change of [value => { value.sourceRevision = null; }, value => { value.sourceRange.start = -1; },
    value => { value.sourceRange.end = source.length + 1; }, value => { value.sourceRange.start = 1.5; },
    value => { value.sourceRange.end = value.sourceRange.start - 1; }, value => { value.sourceRange.encoding = 'utf-8'; },
    value => { value.sourceRange.exact = 'true'; }, value => { value.sourceRange.start = source.indexOf('😀') + 1; },
    value => { value.sourceRange.start = source.indexOf('\r\n') + 1; }]) {
    const altered = structuredClone(valid); change(altered);
    assert.deepEqual(sourceLocationSelection(source, altered, digest(source)), { status: 'unavailable' });
  }
  for (const range of [{ ...valid.sourceRange, exact: false }, { ...valid.sourceRange, propertyPath: '/actors/0' }]) {
    assert.deepEqual(sourceLocationSelection(source, { ...valid, sourceRange: range }, digest(source)), { status: 'approximate' });
  }
});

test('the actual editor source entry opens and selects the observed field without writing or changing line endings', async () => {
  const h = await harness(), info = location();
  opened(await h.runtime.openBuildSource(info.sourcePath, info));
  assert.equal(h.state.isEditing, true); assert.equal(h.state.editInputMode, 'source');
  assert.equal(selected(h), '160'); assert.equal(h.source.value, normalize(source));
  assert.equal(h.runtime.getSourceEditorContent(), source); assert.equal(h.doc._sourceCachedText, source);
  assert.equal(h.state.editHasUnsavedChanges, false); assert.equal(h.state.isLoadingSource, false);
  assert.equal(h.reads.length, 1); assert.equal(h.writes.length, 0);
  assert.match(h.element('docEditStatus').textContent, /已定位来源字段.*\/actors\/0\/speed/);
});

test('uncached source navigation performs one owned read instead of starting a competing automatic preload', async () => {
  const h = await harness(); delete h.doc._sourceCachedText;
  opened(await h.runtime.openBuildSource(h.doc.sourcePath, location()));
  assert.equal(h.reads.length, 1); assert.equal(selected(h), '160');
  assert.equal(h.state.isLoadingSource, false); assert.equal(h.writes.length, 0);
});

test('deferred editor focus runs once and cannot steal focus after navigation, mode changes or dirty edits', async () => {
  const h = await harness(), result = await h.runtime.openBuildSource(h.doc.sourcePath, location());
  h.source.setSelectionRange(0, 0);
  h.source.focus = () => { h.source.focused = true; h.source.setSelectionRange(0, 0); };
  h.source.focused = false;
  assert.equal(result.focus(), true); assert.equal(h.source.focused, true);
  assert.equal(selected(h), '160', 'restore the verified selection after native focus restoration collapses it');
  h.source.focused = false; assert.equal(result.focus(), false); assert.equal(h.source.focused, false);
  for (const interruption of ['mode', 'legacy', 'newer', 'dirty', 'changed-value', 'changed-cache']) {
    const current = await harness(), pending = await current.runtime.openBuildSource(current.doc.sourcePath, location());
    if (interruption === 'mode') current.runtime.setMode('browse');
    else if (interruption === 'legacy') await current.runtime.openBuildSource(current.doc.sourcePath);
    else if (interruption === 'newer') await current.runtime.openBuildSource(current.doc.sourcePath, location(source, current.doc.sourcePath, '[10, 20]', '/actors/0/position'));
    else if (interruption === 'dirty') { current.source.value += 'dirty'; current.runtime.refreshEditSessionDirtyState(); }
    else if (interruption === 'changed-value') current.source.value += 'modified without an input event';
    else current.doc._sourceCachedText = 'new cache from another reader';
    current.source.focused = false;
    assert.equal(pending.focus(), false, interruption); assert.equal(current.source.focused, false, interruption);
  }
});

test('stale and approximate source locations open current text without selecting the old or nearest range', async () => {
  const changed = source.replace('160', '240').replace('旅人', '改变了的旅人'), stale = await harness({ read: () => ({ content: changed, version: '3' }) });
  opened(await stale.runtime.openBuildSource(location().sourcePath, location()));
  assert.equal(stale.source.value, normalize(changed)); assert.equal(selected(stale), '');
  assert.match(stale.element('docEditStatus').textContent, /原文已变化/); assert.equal(stale.state.editHasUnsavedChanges, false);
  const h = await harness(), missing = location(); missing.sourceRange = { ...missing.sourceRange, start: 1, end: source.length - 2, propertyPath: '', exact: false };
  opened(await h.runtime.openBuildSource(missing.sourcePath, missing));
  assert.equal(selected(h), ''); assert.match(h.element('docEditStatus').textContent, /未选择近似范围/);
  assert.equal(h.writes.length + stale.writes.length, 0);
});

test('same-document unsaved text and cursor survive source navigation, while declined cross-document navigation stays put', async () => {
  const h = await harness(), other = h.addDoc(); h.begin(source, 'baseline');
  h.source.value = normalize(source).replace('160', '999'); h.runtime.refreshEditSessionDirtyState(); h.source.setSelectionRange(7, 11);
  const draft = h.source.value;
  assert.equal(h.state.editHasUnsavedChanges, true);
  assert.equal(await h.runtime.openBuildSource(h.doc.sourcePath, location()), true);
  assert.equal(h.source.value, draft); assert.deepEqual([h.source.selectionStart, h.source.selectionEnd], [7, 11]);
  assert.match(h.element('docEditStatus').textContent, /已保留内容和光标/); assert.equal(h.reads.length, 0);
  assert.equal(await h.runtime.openBuildSource(other.sourcePath, location(source, other.sourcePath)), false);
  assert.equal(h.state.activePath, h.doc.path); assert.equal(h.source.value, draft); assert.equal(h.reads.length, 0);
});

test('a late source read cannot update another document or release its active navigation busy state', async () => {
  const calls = [], h = await harness({ read: input => { const wait = deferred(); calls.push({ ...wait, input }); return wait.promise; } });
  const other = h.addDoc(), infoA = location(), rawB = source.replace('160', '320'), infoB = location(rawB, other.sourcePath, '320');
  const first = h.runtime.openBuildSource(infoA.sourcePath, infoA), second = h.runtime.openBuildSource(infoB.sourcePath, infoB);
  assert.equal(calls.length, 2); assert.equal(h.state.isLoadingSource, true);
  calls[0].resolve({ content: source, version: '1' }); assert.equal(await first, false);
  assert.equal(h.state.activePath, other.path); assert.equal(h.state.isLoadingSource, true);
  assert.equal(h.doc._sourceCachedText, 'old cached text');
  calls[1].resolve({ content: rawB, version: '2' }); opened(await second);
  assert.equal(selected(h), '320'); assert.equal(h.state.isLoadingSource, false); assert.equal(other._sourceVersion, '2');
});

test('the newest source request wins even when two locations target the same document', async () => {
  const calls = [], h = await harness({ read: () => { const wait = deferred(); calls.push(wait); return wait.promise; } });
  const first = h.runtime.openBuildSource(h.doc.sourcePath, location());
  const title = location(source, h.doc.sourcePath, '"旅人😀"', '/title'), second = h.runtime.openBuildSource(h.doc.sourcePath, title);
  calls[0].resolve({ content: source, version: '1' }); assert.equal(await first, false); assert.equal(h.state.isLoadingSource, true);
  calls[1].resolve({ content: source, version: '2' }); opened(await second);
  assert.equal(selected(h), '"旅人😀"'); assert.equal(h.doc._sourceVersion, '2');
});

test('a late revision digest cannot overwrite a newly selected location', async () => {
  const hash = deferred(); let hashes = 0;
  const h = await harness({ crypto: { subtle: { digest: (...args) => ++hashes === 1 ? hash.promise : webcrypto.subtle.digest(...args) } } });
  const first = h.runtime.openBuildSource(h.doc.sourcePath, location()); await flush(); assert.equal(hashes, 1);
  const title = location(source, h.doc.sourcePath, '"旅人😀"', '/title');
  opened(await h.runtime.openBuildSource(h.doc.sourcePath, title)); assert.equal(selected(h), '"旅人😀"');
  hash.resolve(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(source)));
  assert.equal(await first, false); assert.equal(selected(h), '"旅人😀"'); assert.equal(h.state.isLoadingSource, false);
});

test('source read and revision digest errors release only their own loading state without changing source or draft', async () => {
  for (const failure of ['read', 'digest']) {
    const h = await harness(failure === 'read' ? { read: () => { throw new Error('read failed'); } }
      : { crypto: { subtle: { digest: async () => { throw new Error('digest failed'); } } } });
    assert.equal(await h.runtime.openBuildSource(h.doc.sourcePath, location()), true);
    assert.equal(h.state.isLoadingSource, false); assert.equal(h.state.isEditing, false);
    assert.equal(h.doc._sourceCachedText, 'old cached text'); assert.equal(h.writes.length, 0);
    assert.match(h.element('docEditStatus').textContent, /无法精确定位/);
  }
  const oldHash = deferred(); let hashes = 0;
  const h = await harness({ crypto: { subtle: { digest: (...args) => ++hashes === 1 ? oldHash.promise : webcrypto.subtle.digest(...args) } } });
  const first = h.runtime.openBuildSource(h.doc.sourcePath, location()); await flush();
  const title = location(source, h.doc.sourcePath, '"旅人😀"', '/title');
  await h.runtime.openBuildSource(h.doc.sourcePath, title);
  const status = h.element('docEditStatus').textContent;
  oldHash.reject(new Error('late digest failure'));
  assert.equal(await first, false); assert.equal(selected(h), '"旅人😀"');
  assert.equal(h.element('docEditStatus').textContent, status); assert.equal(h.state.isLoadingSource, false);
});

test('a mode change or a newer legacy link cancels pending precise selection', async () => {
  for (const interruption of ['mode', 'legacy']) {
    const read = deferred(), h = await harness({ read: () => read.promise });
    const pending = h.runtime.openBuildSource(h.doc.sourcePath, location());
    if (interruption === 'mode') h.runtime.setMode('browse');
    else assert.equal(await h.runtime.openBuildSource(h.doc.sourcePath, { sourcePath: h.doc.sourcePath }), true);
    const text = h.source.value;
    read.resolve({ content: source, version: '2' });
    assert.equal(await pending, false); assert.equal(h.source.value, text); assert.equal(h.state.isEditing, false);
    assert.equal(h.state.isLoadingSource, false); assert.equal(h.doc._sourceCachedText, 'old cached text');
    assert.equal(h.writes.length, 0);
  }
});

test('navigation checks catalog identity and newly dirty text after asynchronous reads', async () => {
  for (const replace of [false, true]) {
    const read = deferred(), h = await harness({ read: () => read.promise });
    const pending = h.runtime.openBuildSource(h.doc.sourcePath, location());
    if (replace) { h.state.docs = [{ ...h.doc, _sourceCachedText: 'replacement catalog content' }]; h.runtime.rebuildDocPathCaches(h.state.docs); }
    else { h.begin(source); h.source.value = 'draft created during read'; h.runtime.refreshEditSessionDirtyState(); }
    read.resolve({ content: source, version: 'late' });
    assert.equal(await pending, !replace);
    if (replace) assert.equal(h.state.docs[0]._sourceCachedText, 'replacement catalog content');
    else { assert.equal(h.source.value, 'draft created during read'); assert.equal(h.state.editHasUnsavedChanges, true); }
    assert.equal(h.state.isLoadingSource, false); assert.equal(h.writes.length, 0);
  }
});

test('legacy links retain document navigation and malformed locations never select another file', async () => {
  const h = await harness();
  assert.equal(await h.runtime.openBuildSource(h.doc.sourcePath, { sourcePath: h.doc.sourcePath, propertyPath: '/actors/0/speed' }), true);
  assert.equal(h.state.isEditing, false); assert.equal(h.reads.length, 0);
  const wrong = { ...location(), sourcePath: 'documents/other.json' };
  assert.equal(await h.runtime.openBuildSource(h.doc.sourcePath, wrong), true);
  assert.equal(h.state.isEditing, false); assert.equal(h.reads.length, 0);
  await assert.rejects(h.runtime.openBuildSource('documents/missing.json', location()), /unavailable/);
});

test('source navigation messages and scene declaration links have English and Japanese translations', () => {
  for (const key of ['已打开文档，但无法精确定位来源。请刷新构建或场景预览后重试。',
    '当前文档有未保存草稿，已保留内容和光标；请保存或取消修改后再定位来源。', '已定位来源字段：{0}',
    '原文已变化，已打开当前文档；请刷新构建或场景预览后重新定位。', '该字段没有独立的原文位置，已打开来源文档，未选择近似范围。', '打开场景声明']) {
    assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`);
  }
});

test('scene preview captures exact unsaved text and the original baseline without reading or saving', async () => {
  const h = await harness(); h.begin(source, digest(source)); h.state.activeEditSource = h.doc.sourcePath;
  const draft = source.replace('160', '2.5e2');
  h.source.value = normalize(draft); h.runtime.refreshEditSessionDirtyState();
  const result = await h.runtime.getScenePreviewDraft(h.doc.sourcePath);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { sourcePath: h.doc.sourcePath, baseSourceRevision: digest(source), content: draft });
  assert.equal(h.state.editHasUnsavedChanges, true);
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
  assert.equal(await h.runtime.getScenePreviewDraft('documents/scenes/other.json'), null);
  h.state.isCreating = true; assert.equal(await h.runtime.getScenePreviewDraft(h.doc.sourcePath), null);
  h.state.isCreating = false; h.source.value = normalize(source); h.runtime.refreshEditSessionDirtyState();
  assert.equal(await h.runtime.getScenePreviewDraft(h.doc.sourcePath), null);
});

test('scene draft capture rejects changed content or a mismatched recovery baseline during asynchronous hashing', async () => {
  const pending = deferred();
  const h = await harness({ crypto: { subtle: { digest: () => pending.promise } } });
  h.begin(source, digest(source)); h.state.activeEditSource = h.doc.sourcePath; h.source.value = normalize(source.replace('160', '250')); h.runtime.refreshEditSessionDirtyState();
  const request = h.runtime.getScenePreviewDraft(h.doc.sourcePath);
  h.source.value += ' '; h.runtime.refreshEditSessionDirtyState();
  pending.resolve(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(source)));
  assert.equal(await request, null);
  const other = await harness(); other.begin(source, digest('different baseline')); other.state.activeEditSource = other.doc.sourcePath;
  other.source.value += ' '; other.runtime.refreshEditSessionDirtyState();
  assert.equal(await other.runtime.getScenePreviewDraft(other.doc.sourcePath), null);
});

test('draft source navigation selects current unsaved Unicode/CRLF text and restores focus without disk reads', async () => {
  const h = await harness(); h.begin(source, digest(source)); h.state.activeEditSource = h.doc.sourcePath;
  const draft = source.replace('旅人😀', '草稿😀🌿').replace('160', '250');
  h.source.value = normalize(draft); h.runtime.refreshEditSessionDirtyState();
  const info = { ...location(draft, h.doc.sourcePath, '250'), previewDraft: true };
  const opened = await h.runtime.openBuildSource(h.doc.sourcePath, info);
  assert.equal(selected(h), '250'); assert.equal(h.runtime.getSourceEditorContent(), draft);
  h.source.setSelectionRange(0, 0); assert.equal(opened.focus(), true); assert.equal(selected(h), '250');
  assert.equal(opened.focus(), false); assert.equal(h.state.editHasUnsavedChanges, true);
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
  assert.match(h.element('docEditStatus').textContent, /已定位草稿字段/);
});

test('stale, approximate or missing draft ranges keep both text and caret; foreign draft navigation never selects a document', async () => {
  const h = await harness(); h.begin(source, digest(source)); h.state.activeEditSource = h.doc.sourcePath;
  const draft = source.replace('160', '250'); h.source.value = normalize(draft); h.runtime.refreshEditSessionDirtyState();
  const exact = location(draft, h.doc.sourcePath, '250');
  const cases = [location(source), { ...exact, sourceRange: { ...exact.sourceRange, exact: false } }, { ...exact, sourceRange: undefined }];
  for (const info of cases) {
    h.source.setSelectionRange(2, 5);
    assert.equal(await h.runtime.openBuildSource(h.doc.sourcePath, { ...info, previewDraft: true }), true);
    assert.equal(h.source.selectionStart, 2); assert.equal(h.source.selectionEnd, 5);
    assert.equal(h.runtime.getSourceEditorContent(), draft);
  }
  const other = h.addDoc();
  assert.equal(await h.runtime.openBuildSource(other.sourcePath, { ...exact, sourcePath: other.sourcePath, previewDraft: true }), false);
  assert.equal(h.state.activePath, h.doc.path); assert.equal(h.state.editHasUnsavedChanges, true);
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
});

test('draft source hash and deferred focus cannot overwrite or steal focus from newer edits', async () => {
  for (const phase of ['hash', 'focus']) {
    const pending = deferred();
    const h = await harness(phase === 'hash' ? { crypto: { subtle: { digest: () => pending.promise } } } : {});
    h.begin(source, digest(source)); h.state.activeEditSource = h.doc.sourcePath; const draft = source.replace('160', '250');
    h.source.value = normalize(draft); h.runtime.refreshEditSessionDirtyState();
    const request = h.runtime.openBuildSource(h.doc.sourcePath, { ...location(draft, h.doc.sourcePath, '250'), previewDraft: true });
    const opened = phase === 'focus' ? await request : null;
    h.source.value += ' '; h.runtime.refreshEditSessionDirtyState(); h.source.setSelectionRange(1, 1);
    if (phase === 'hash') {
      pending.resolve(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(draft)));
      assert.equal(await request, false);
    } else assert.equal(opened.focus(), false);
    assert.equal(h.source.selectionStart, 1); assert.equal(h.source.selectionEnd, 1);
    assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
  }
});

test('unchanged editor UI refreshes do not invalidate a pending draft hash or its later focus', async () => {
  const pending = deferred(); const h = await harness({ crypto: { subtle: { digest: () => pending.promise } } });
  h.begin(source, digest(source)); h.state.activeEditSource = h.doc.sourcePath;
  h.source.value = normalize(source.replace('160', '250')); h.runtime.refreshEditSessionDirtyState();
  const request = h.runtime.getScenePreviewDraft(h.doc.sourcePath);
  h.runtime.updateEditUnsavedUi(); h.runtime.updateEditUnsavedUi();
  pending.resolve(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(source)));
  assert.equal((await request).content, source.replace('160', '250'));
  const current = await harness(); current.begin(source, digest(source)); current.state.activeEditSource = current.doc.sourcePath;
  const draft = source.replace('160', '250'); current.source.value = normalize(draft); current.runtime.refreshEditSessionDirtyState();
  const result = await current.runtime.openBuildSource(current.doc.sourcePath, { ...location(draft, current.doc.sourcePath, '250'), previewDraft: true });
  current.runtime.updateEditUnsavedUi(); assert.equal(result.focus(), true); assert.equal(selected(current), '250');
});
