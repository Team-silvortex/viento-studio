import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parse } from 'acorn';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { validateBackendProjectManifest } from '../../engine/backend-project.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = value => `aaaaaaaa-aaaa-4aaa-8aaa-${value.toString(16).padStart(12, '0')}`;
const hash = value => value.toString(16).padStart(64, '0');
const revision = value => `sha256:${hash(value)}`;
const sceneId = id(1), buildId = id(2), oldBuildId = id(3), assetId = id(4), scriptId = id(5);
const backendId = 'org.viento.godot4';
const clone = value => JSON.parse(JSON.stringify(value));
function manifest({ backend = backendId, build = buildId, adapter = true, images = true } = {}) {
  const bevy = backend === 'org.viento.bevy';
  const file = (path, role = 'generated', resourceId = null, sourceObjectId = null) => ({ path, role, resourceId, sourceObjectId, size: 32, sha256: hash(10) });
  const files = bevy ? [file('project/scene-data.json')] : [file(`project/behaviors/${scriptId}.gd`, 'author-source-copy', null, scriptId),
    ...(images ? [file(`project/images/${assetId}.png`, 'resource-copy', assetId)] : []), file('project/main.tscn'), file('project/project.godot'), file('project/runtime.gd')];
  return validateBackendProjectManifest({ format: 'viento-backend-project', schemaVersion: 1, buildId: build, snapshotId: revision(1),
    source: { workspaceId: 'frozen-author-workspace', sceneId, sourcePath: 'documents/scenes/frozen-scene.json', sourceRevision: revision(2), planKind: 'scene2d', planSchemaVersion: 2 },
    backend: { id: backend, version: bevy ? '0.3.0' : '0.5.0', protocolVersion: 2, sha256: hash(3) },
    executionAdapter: adapter ? { id: backend, contractVersion: 1, sha256: hash(4) } : null,
    tool: { version: bevy ? 'viento-bevy-runtime 0.3.0 bevy 0.19.1' : '4.7.2.stable', sha256: hash(5), platform: 'linux', arch: 'x64' },
    project: { kind: bevy ? 'bevy-scene' : 'godot-project', root: 'project', entry: bevy ? 'project/scene-data.json' : 'project/project.godot', requiresTool: true },
    files, resources: !bevy && images ? [{ resourceId: assetId, sourcePath: 'pictures/original.png', generatedPath: `project/images/${assetId}.png`, size: 32, sha256: hash(10) }] : [],
    dependencies: [
      { objectId: scriptId, sourcePath: 'documents/behaviors/mover.txt', sourceRevision: revision(3), role: 'behavior-source' },
      { objectId: null, sourcePath: 'documents/notes/未登记:备注.txt', sourceRevision: null, role: 'author-document' },
      { objectId: sceneId, sourcePath: 'documents/scenes/frozen-scene.json', sourceRevision: revision(2), role: 'scene' },
    ],
    evidence: ['build.json', 'snapshot.json', 'source-map.json'].map(path => ({ path, size: 64, sha256: hash(6) })),
    lifecycle: { authority: 'author-workspace', generatedProject: 'derived-read-only', resources: 'copies', rebuild: 'saved-author-inputs', runtimeCopies: 'temporary', persistence: 'until-owner-cleanup' },
  });
}
function summary(project = manifest(), extra = {}) {
  return { id: project.buildId, sceneId: project.source.sceneId, backendId: project.backend.id, snapshotId: project.snapshotId,
    title: '<img onerror=window.bad> 作者名', status: 'succeeded', createdAt: '2026-10-11T00:00:00.000Z', retention: 'automatic', retentionReason: null, ...extra };
}
function receipt(project = manifest(), inspection = {}) {
  return { project, buildDirectory: '/cache/viento/editor/author-hash/org.viento.godot4/build-one',
    inspection: { recorded: true, complete: true, manifestSha256: hash(7), extraPaths: [], ...inspection } };
}
async function view({ project = manifest(), rows, current = {}, result } = {}) {
  const calls = [], languages = [];
  let state = { available: true, visible: true, session: 1, sceneId, backendId: project.backend.id, backendIdentity: 'descriptor-signature-one',
    projects: rows || [summary(project)], projectManagement: { format: 'viento-backend-project-management', schemaVersion: 1,
      scope: 'service-session', retentionLimit: 3, preservedCount: 0, previousSessions: 'cli-inspect' }, ...current };
  let dictionary = {}, respond = () => result || receipt(project);
  const translate = (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '');
  const h = await dialogHarness('app-backend-project', {
    validateBackendProjectManifest: value => validateBackendProjectManifest(clone(value)),
    t: translate, translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: listener => { languages.push(listener); return () => { const index = languages.indexOf(listener); if (index >= 0) languages.splice(index, 1); }; },
  });
  const realm = vm.runInContext('value => JSON.parse(JSON.stringify(value))', h.runtime);
  const container = h.document.createElement('div'); h.document.body.append(container);
  const controller = h.runtime.setupBackendProject({ container, getState: () => state,
    request: async body => { calls.push(clone(body)); return realm(await respond(body)); } });
  return { ...h, controller, calls, container, get state() { return state; },
    setState(value) { state = value; controller.render(); }, respond(value) { respond = typeof value === 'function' ? value : () => value; },
    language(value) { dictionary = value; languages.forEach(listener => listener()); },
    select(value) { h.element('backendProjectSelect').value = value; h.element('backendProjectSelect').dispatch('change'); },
    async open(value) { const accepted = await controller.open(value); await flushDialogs(); return accepted; },
  };
}

test('legacy hosts, foreign scene/backend, malformed and duplicate summaries cannot expose a project read', async () => {
  const h = await view({ current: { projects: undefined } });
  assert.equal(h.element('backendProjectPanel').hidden, true); assert.equal(await h.open(buildId), false); assert.equal(h.calls.length, 0);
  h.setState({ ...h.state, projects: [summary(manifest(), { sceneId: id(99) }), summary(manifest(), { backendId: 'org.viento.bevy' }),
    summary(manifest(), { snapshotId: 'bad' }), summary(manifest()), summary(manifest())] });
  assert.equal(h.element('backendProjectSelect').children.length, 1); assert.equal(await h.open(), true);
  assert.deepEqual(h.calls, [{ action: 'inspect-project', buildId }]);
});

test('older project selection is independent of the latest run build and authored labels stay text', async () => {
  const old = manifest({ build: oldBuildId }), h = await view({ rows: [summary(), summary(old)], current: { latestBuild: { id: buildId } } });
  assert.equal(h.element('backendProjectSelect').value, buildId);
  h.select(oldBuildId); h.respond(receipt(old)); assert.equal(await h.open(), true);
  assert.equal(h.state.latestBuild.id, buildId); assert.deepEqual(h.calls, [{ action: 'inspect-project', buildId: oldBuildId }]);
  assert.match(h.element('backendProjectSelect').children[0].textContent, /<img onerror/);
  assert.equal(h.container.querySelectorAll('img').length, 0);
  assert.match(h.element('backendProjectContent').textContent, new RegExp(oldBuildId));
});

test('successful Godot details expose exact frozen source, tool and adapter plus classified files and evidence', async () => {
  const h = await view({ current: { liveSourcePath: 'documents/live/renamed.json', dirty: true } }); await h.open();
  const text = h.element('backendProjectContent').textContent;
  for (const value of ['Godot 生成工程', 'project/project.godot', 'frozen-author-workspace', 'documents/scenes/frozen-scene.json',
    '4.7.2.stable', hash(3), hash(4), hash(5), '作者源码副本', '素材副本', '适配器生成', 'documents/notes/未登记:备注.txt', '未记录']) assert.ok(text.includes(value), value);
  assert.ok(!text.includes('renamed.json')); assert.equal(h.element('backendProjectFiles').children.length, 5);
  assert.equal(h.element('backendProjectResources').children.length, 1); assert.equal(h.element('backendProjectEvidence').children.length, 3);
  assert.match(h.element('backendProjectStatus').textContent, /未启动引擎或检查当前工具/);
  assert.equal(h.container.querySelectorAll('textarea').length, 0); assert.equal(h.container.querySelectorAll('a').length, 0);
});

test('Bevy details distinguish scene data from Cargo, author Rust and a standalone distribution', async () => {
  const h = await view({ project: manifest({ backend: 'org.viento.bevy' }) }); await h.open();
  assert.match(h.element('backendProjectContent').textContent, /Bevy 场景数据工程/);
  assert.match(h.element('backendProjectContent').textContent, /不是 Cargo 工程，不编译作者 Rust，也不是独立发行程序/);
  assert.match(h.element('backendProjectContent').textContent, /没有复制素材/);
  assert.equal(h.element('backendProjectFiles').children.length, 1); assert.equal(h.calls.length, 1);
});

test('old unrecorded manifests disclose read-only reconstruction and missing adapter facts', async () => {
  const project = manifest({ adapter: false }), h = await view({ project, result: receipt(project, { recorded: false, manifestSha256: null }) }); await h.open();
  assert.match(h.element('backendProjectContent').textContent, /旧工程没有独立工程清单/);
  assert.match(h.element('backendProjectContent').textContent, /不会写回旧目录/);
  assert.match(h.element('backendProjectContent').textContent, /未记录/);
});

test('read-only inspection is available with dirty author drafts, offline sources, unavailable tools and active runs', async () => {
  const h = await view({ current: { dirty: true, offline: true, toolStatus: { status: 'unavailable' }, active: true } });
  assert.equal(h.element('backendProjectInspect').disabled, false); await h.open();
  assert.deepEqual(h.calls, [{ action: 'inspect-project', buildId }]);
  assert.match(h.element('backendProjectContent').textContent, /新的计划或构建仍需要已保存作者输入/);
});

test('failed, cancelled and timeout records are visible but never authorize inspecting or running an intact project', async () => {
  for (const status of ['failed', 'cancelled', 'timeout']) {
    const h = await view({ rows: [summary(manifest(), { status })] });
    assert.equal(h.element('backendProjectPanel').hidden, false); assert.equal(h.element('backendProjectInspect').disabled, true);
    assert.match(h.element('backendProjectSelection').textContent, /此构建未成功/); assert.equal(await h.open(), false); assert.equal(h.calls.length, 0);
  }
});

test('all six preserved reasons explain why a project is outside automatic cleanup', async () => {
  const reasons = { backend_project_changed: /生成文件或清单已变化/, backend_project_extra_paths: /清单外内容/,
    backend_project_link: /链接或特殊文件/, backend_project_sessions_retained: /运行记录/,
    backend_project_owner_changed: /位置或身份已变化/, backend_project_cleanup_failed: /自动回收未完成/ };
  for (const [retentionReason, expected] of Object.entries(reasons)) {
    const h = await view({ rows: [summary(manifest(), { retention: 'preserved', retentionReason })] });
    assert.match(h.element('backendProjectSelection').textContent, expected); assert.equal(h.element('backendProjectInspect').disabled, false);
  }
});

test('pending reads lock picker and repeated inspect while close cancels only the view', async () => {
  const h = await view(), waiting = deferred(); h.respond(() => waiting.promise); const open = h.controller.open();
  assert.equal(h.element('backendProjectSelect').disabled, true); assert.equal(h.element('backendProjectInspect').disabled, true);
  assert.equal(await h.controller.open(), false); h.element('backendProjectClose').click();
  assert.equal(h.element('backendProjectDetails').hidden, true); waiting.resolve(receipt()); assert.equal(await open, false);
  assert.equal(h.element('backendProjectContent').textContent, ''); assert.equal(h.calls.length, 1);
});

test('new open survives a late closed read and late failure never alerts or damages the new view', async () => {
  const h = await view(), waiting = deferred(); h.respond(() => waiting.promise); const first = h.controller.open();
  h.controller.closed(); h.respond(receipt()); assert.equal(await h.open(), true);
  waiting.reject(Object.assign(new Error('late failure'), { errorCode: 'backend_project_changed' })); assert.equal(await first, false);
  assert.equal(h.element('backendProjectError').hidden, true); assert.match(h.element('backendProjectContent').textContent, /Godot/);
});

test('scene, descriptor and parent session changes invalidate a pending response and existing detail', async () => {
  for (const change of [{ sceneId: id(99) }, { backendIdentity: 'new-descriptor' }, { session: 2 }, { visible: false }, { available: false }]) {
    const h = await view(), waiting = deferred(); h.respond(() => waiting.promise); const open = h.controller.open();
    h.setState({ ...h.state, ...change }); waiting.resolve(receipt()); assert.equal(await open, false);
    assert.equal(h.element('backendProjectDetails').hidden, true); assert.equal(h.element('backendProjectContent').textContent, '');
  }
});

test('pruned, retention-changed or mismatched summary ownership cannot retain an old approval', async () => {
  for (const rows of [[], [summary(manifest(), { snapshotId: revision(99) })],
    [summary(manifest(), { retention: 'preserved', retentionReason: 'backend_project_changed' })]]) {
    const h = await view(); await h.open(); h.setState({ ...h.state, projects: rows });
    assert.equal(h.element('backendProjectDetails').hidden, true); assert.equal(h.element('backendProjectContent').textContent, '');
  }
});

test('forged build, scene, snapshot and backend manifests are rejected before any detail content', async () => {
  for (const mutate of [value => value.buildId = id(99), value => value.source.sceneId = id(99), value => value.snapshotId = revision(99),
    value => { value.backend.id = 'org.viento.other'; value.executionAdapter.id = 'org.viento.other'; }]) {
    const result = receipt(); const mutable = clone(result); mutate(mutable.project);
    const h = await view({ result: mutable }); assert.equal(await h.open(), false);
    assert.match(h.element('backendProjectError').textContent, /工程清单无效/); assert.equal(h.element('backendProjectContent').textContent, '');
  }
});

test('unvalidated generated paths, roles and resource mismatches cannot be rendered as inventory', async () => {
  for (const mutate of [value => value.files[0].path = 'project/../escape', value => value.files[0].role = 'custom-script',
    value => value.resources[0].sha256 = hash(99), value => value.project.entry = 'project/missing.godot']) {
    const result = clone(receipt()); mutate(result.project); const h = await view({ result }); assert.equal(await h.open(), false);
    assert.equal(h.element('backendProjectContent').textContent, ''); assert.equal(h.element('backendProjectError').hidden, false);
  }
});

test('partial directory inventories visibly remain incomplete, and contradictory complete receipts fail closed', async () => {
  const result = receipt(manifest(), { complete: false, extraPaths: [{ path: 'project/user-note.txt', kind: 'file' }] });
  const h = await view({ result }); assert.equal(await h.open(), true);
  assert.match(h.element('backendProjectStatus').textContent, /未完整通过/); assert.match(h.element('backendProjectExtraPaths').textContent, /user-note/);
  h.controller.closed(); result.inspection.complete = true; h.respond(result); assert.equal(await h.open(), false);
  assert.equal(h.element('backendProjectContent').textContent, '');
});

test('unknown Linux names are visibly escaped, and the inspection inventory budget matches the host', async () => {
  const extraPaths = Array.from({ length: 1025 }, (_, index) => ({ path: `project/external-${index}.txt`, kind: 'file' }));
  extraPaths[0].path = 'project/line\nbreak\ttab:note.txt';
  const h = await view({ result: receipt(manifest(), { complete: false, extraPaths }) }); assert.equal(await h.open(), true);
  assert.equal(h.element('backendProjectExtraPaths').children.length, 1025);
  assert.match(h.element('backendProjectExtraPaths').textContent, /line\\nbreak\\ttab:note/);
  h.controller.closed(); h.respond(receipt(manifest(), { complete: false, extraPaths: Array.from({ length: 16385 }, () => ({ path: 'project/extra', kind: 'file' })) }));
  assert.equal(await h.open(), false); assert.match(h.element('backendProjectError').textContent, /超出读取限制/);
});

test('unsafe extra inventory paths fail closed and directory ownership errors receive a specific explanation', async () => {
  for (const path of ['../escape', '/absolute', 'project/../escape', 'project/\0bad']) {
    const h = await view({ result: receipt(manifest(), { complete: false, extraPaths: [{ path, kind: 'file' }] }) });
    assert.equal(await h.open(), false); assert.equal(h.element('backendProjectContent').textContent, '');
  }
  const h = await view(); h.respond(() => { throw Object.assign(new Error('changed inode'), { errorCode: 'backend_project_owner_changed' }); });
  assert.equal(await h.open(), false); assert.match(h.element('backendProjectError').textContent, /无法确认原工程/);
});

test('invalid inspection receipts and unsafe display directories fail closed without path navigation', async () => {
  for (const update of [{ inspection: { recorded: true, complete: true } },
    { inspection: { recorded: true, complete: 'yes', manifestSha256: hash(7), extraPaths: [] } },
    { buildDirectory: '/cache/unsafe\npath' }, { buildDirectory: '' }]) {
    const h = await view({ result: { ...receipt(), ...update } }); assert.equal(await h.open(), false);
    assert.equal(h.element('backendProjectContent').textContent, ''); assert.equal(h.container.querySelectorAll('a').length, 0);
  }
});

test('changed engineering files produce a specific safe explanation and preserve the selected row', async () => {
  const h = await view(); h.respond(() => { throw Object.assign(new Error('<script>unsafe path</script>'), { errorCode: 'backend_project_changed' }); });
  assert.equal(await h.open(), false); assert.match(h.element('backendProjectError').textContent, /工程文件或清单已变化/);
  assert.doesNotMatch(h.element('backendProjectError').textContent, /script/); assert.equal(h.element('backendProjectSelect').value, buildId);
  assert.equal(h.element('backendProjectInspect').disabled, false);
});

test('Chinese, English and Japanese retranslate structured details while author paths and versions stay literal', async () => {
  const h = await view(); await h.open();
  for (const [dictionary, title] of [[{}, '后端工程详情'], [en, 'Backend project details'], [ja, 'バックエンドプロジェクトの詳細']]) {
    h.language(dictionary); assert.equal(h.element('backendProjectDetailsTitle').textContent, title);
    assert.ok(h.element('backendProjectSelect').children[0].textContent.includes(dictionary['构建完成'] || '构建完成'));
    assert.ok(h.element('backendProjectSelect').children[0].textContent.includes('<img onerror=window.bad> 作者名'));
    assert.ok(h.element('backendProjectContent').textContent.includes('documents/notes/未登记:备注.txt'));
    assert.ok(h.element('backendProjectContent').textContent.includes('4.7.2.stable'));
  }
});

test('all interface keys in the new view and retention reasons have English and Japanese entries', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-backend-project.js', import.meta.url), 'utf8');
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), keys = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'Literal' && typeof value.value === 'string' && /[\u4e00-\u9fff]/.test(value.value)) keys.add(value.value);
    for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit); else if (typeof child === 'object') visit(child);
  }; visit(ast);
  for (const [, key] of source.matchAll(/data-i18n="([^"]+)"/g)) keys.add(key);
  for (const key of keys) for (const dictionary of [en, ja]) assert.ok(Object.hasOwn(dictionary, key), key);
  assert.ok(keys.size > 80);
});

test('destroy is idempotent and detached read completion cannot recreate UI', async () => {
  const h = await view(), waiting = deferred(); h.respond(() => waiting.promise); const open = h.controller.open();
  h.controller.dispose(); h.controller.destroy(); waiting.resolve(receipt()); assert.equal(await open, false);
  assert.equal(h.container.children.length, 0); h.language(en); assert.equal(h.container.children.length, 0);
});


test('the Bevy Rust source project reports its Cargo entry, frozen authors and source-only delivery in all three languages', async () => {
  const project = clone(manifest({ backend: 'org.viento.bevy-rust', images: false }));
  project.project.kind = 'bevy-rust-project'; project.project.entry = 'project/Cargo.toml';
  project.tool.version = 'rustc 1.93.0';
  const generated = project.files.find(file => file.role === 'generated');
  project.files = [
    { ...generated, path: 'project/Cargo.lock' }, { ...generated, path: 'project/Cargo.toml' },
    { ...generated, path: 'project/src/main.rs' },
    { ...project.files.find(file => file.role === 'author-source-copy'), path: `project/src/behavior_${scriptId.replaceAll('-', '_')}.rs` },
  ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const h = await view({ project: validateBackendProjectManifest(project) }); await h.open();
  const hint = '这是包含作者 Rust 行为的 Cargo 源工程。需要匹配的 Rust 工具链与锁定依赖；编译缓存和可执行文件不随工程交付。';
  for (const dictionary of [{}, en, ja]) {
    h.language(dictionary); const text = h.element('backendProjectContent').textContent;
    assert.ok(text.includes(dictionary['Bevy Rust 源工程'] || 'Bevy Rust 源工程'));
    assert.ok(text.includes(dictionary[hint] || hint));
    for (const value of ['project/Cargo.toml', 'project/Cargo.lock', 'rustc 1.93.0', 'org.viento.bevy-rust', 'documents/behaviors/mover.txt']) assert.ok(text.includes(value), value);
    assert.ok(!text.includes('Bevy 工程只有场景数据')); assert.equal(h.calls.length, 1);
  }
});
