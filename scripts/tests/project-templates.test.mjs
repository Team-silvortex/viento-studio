import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PROJECT_TEMPLATE_CATALOG as catalog, WORKSPACE_LAYOUT, PROJECT_DEFAULTS, projectDefinition, resolveDocumentDefinition, validateProjectTypes } from '../lib/project-layout.mjs';
import { parseSourceContent, createDocumentFieldDraft, serializeFieldDraft } from '../../engine/index.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';
import { canonicalJson } from '../../engine/world-projection.mjs';
import { readProjectConfiguration, saveProjectTemplate } from '../lib/project-service.mjs';
import { registerWorkspace, readWorkspace } from '../lib/workspace.mjs';
import { fixture, write } from './helpers.mjs';
import { nativeMobileLibrary } from './mobile-native-harness.mjs';
import { createMobilePlatform } from '../../mobile/platform.mjs';
import english from '../../web/i18n/en.js';
import japanese from '../../web/i18n/ja.js';

test('builtin project packages are closed, parseable and independent of the physical workspace layout', () => {
  assert.deepEqual(Object.keys(WORKSPACE_LAYOUT), ['paths', 'assetStores']);
  assert.equal(catalog.format, 'viento-project-template-catalog');
  assert.equal(catalog.version, 1);
  const packages = [...catalog.templates, ...catalog.compatibilityTemplates];
  assert.equal(new Set(packages.map(item => item.packageId)).size, packages.length);
  assert.deepEqual(catalog.templates.map(item => item.packageId), [
    'org.viento.blank', 'org.viento.oc-game', 'org.viento.oc-literature', 'org.viento.oc-drama', 'org.viento.software-design',
  ]);
  assert.ok(catalog.templates.some(item => item.packageId === catalog.defaultTemplate));
  assert.equal(catalog.templates.find(item => item.packageId === catalog.defaultTemplate).documentTypes.length, 1);
  for (const template of packages) {
    assert.equal(template.format, 'viento-project-template');
    assert.equal(template.schemaVersion, 1);
    validateProjectTypes({ version: 3, documentTypes: template.documentTypes });
    for (const messages of [english, japanese]) {
      assert.ok(messages[template.label]); assert.ok(messages[template.description]);
    }
    assert.deepEqual([...new Set(template.documentTypes.map(item => item.template))].sort(), Object.keys(template.templates).sort());
    for (const type of template.documentTypes) {
      assert.equal(getCreatePathError(`documents/${type.directory ? `${type.directory}/` : ''}example.md`), '');
      const parsed = parseSourceContent(template.templates[type.template], type.template, type);
      assert.equal(parsed.parseError, undefined, `${template.packageId}: ${type.id}`);
    }
  }
  const legacy = catalog.compatibilityTemplates.find(item => item.packageId === catalog.legacyTemplate);
  assert.deepEqual(PROJECT_DEFAULTS.documentTypes, legacy.documentTypes);
  assert.equal(createHash('sha256').update(canonicalJson(legacy)).digest('hex'), '30545b1162327ee60172cdbe0255a3f85729f668d036a7ff358be8259fe1dc90');
});

test('game, literature and drama templates have independent roles and keep dialogue in prose', () => {
  const pack = id => catalog.templates.find(item => item.packageId === `org.viento.oc-${id}`);
  const game = pack('game'), literature = pack('literature'), drama = pack('drama');
  for (const [template, ownType, absentType] of [[game, 'ability', 'chapter'], [literature, 'chapter', 'ability'], [drama, 'act', 'quest']]) {
    assert.ok(template.documentTypes.some(item => item.id === ownType));
    assert.ok(!template.documentTypes.some(item => item.id === absentType));
    assert.match(template.templates['character.md'], /背景与经历/);
    assert.ok(!template.documentTypes.some(item => item.id === 'backstory'));
  }
  assert.equal(new Set([game, literature, drama].map(template => template.templates['character.md'])).size, 3);
  for (const [template, id] of [[literature, 'outline'], [literature, 'chapter'], [drama, 'act'], [drama, 'scene']]) {
    const type = template.documentTypes.find(item => item.id === id);
    const dialogue = '# 相遇\n\n（灯光渐亮）\n\n人物甲：你是谁？\n\n人物乙：旅人。\n\n人物甲：我也是。\n';
    const parsed = parseSourceContent(dialogue, type.template, type);
    assert.deepEqual(parsed.fields, { _header: '相遇' });
    assert.deepEqual(parsed.blocks.filter(block => block.type === 'paragraph').map(block => block.text), ['（灯光渐亮）', '人物甲：你是谁？', '人物乙：旅人。', '人物甲：我也是。']);
  }
  const item = game.documentTypes.find(type => type.id === 'item');
  const parsed = parseSourceContent('# 道具\n\n自定义容量：0\n用途：解谜\n', item.template, item);
  assert.deepEqual(parsed.fields, { _header: '道具', 自定义容量: '0', 用途: '解谜' });
});

test('same IDs and filenames do not share template content or mutable field definitions across projects', async (t) => {
  const roots = await Promise.all([fixture(t), fixture(t)]);
  const manifests = [];
  for (const [index, root] of roots.entries()) {
    const type = { id: 'character', label: `工程 ${index}`, directory: '', template: 'character.md', parserProfile: 'structured',
      parserOptions: { titleField: `名称${index}` }, fieldGroups: [{ title: `分组${index}`, fields: [`名称${index}`] }] };
    const manifest = { format: 'viento-workspace', version: 3, id: randomUUID(), name: `独立工程${index}`, createdAt: 1,
      ...WORKSPACE_LAYOUT, documentTypes: [type], projectTemplate: { packageId: 'example.origin', version: '1.0.0', digest: 'sha256:original' } };
    manifests.push(manifest);
    await fs.mkdir(path.join(root, 'documents'));
    await write(root, 'workspace.json', JSON.stringify(manifest));
    await write(root, 'templates/character.md', `# 模板${index}\n\n名称${index}：对象${index}\n`);
    await registerWorkspace(root);
  }
  const [first, second] = await Promise.all(roots.map(readProjectConfiguration));
  assert.notEqual(first.entries[0].content, second.entries[0].content);
  assert.equal(projectDefinition(manifests[0]).documentTypes[0].content, '');
  assert.match(projectDefinition({ version: 2 }).documentTypes[1].content, /外貌与性格/);
  const exposed = projectDefinition(manifests[0]);
  exposed.documentTypes[0].parserOptions.titleField = 'Changed';
  exposed.documentTypes[0].fieldGroups[0].fields.push('Other');
  assert.equal(manifests[0].documentTypes[0].parserOptions.titleField, '名称0');
  assert.deepEqual(resolveDocumentDefinition(manifests[1], 'documents/one.md').fieldGroups[0].fields, ['名称1']);
  await saveProjectTemplate(roots[0], { revision: first.revision, type: first.entries[0].type, format: 'md', content: '# 修改后的模板\n' });
  assert.deepEqual(await readProjectConfiguration(roots[1]), second);
  assert.deepEqual(readWorkspace(roots[0]).projectTemplate, manifests[0].projectTemplate);
  await fs.rm(path.join(roots[1], 'templates/character.md'));
  const missing = await readProjectConfiguration(roots[1]);
  assert.equal(missing.entries[0].content, '');
  assert.ok(missing.entries[0].problem);
  assert.match(PROJECT_DEFAULTS.templates['character.md'], /外貌与性格/);
});

test('native project selection, field editing and archive restore use a self-contained template snapshot', {
  skip: !process.env.VIENTO_MOBILE_STORE_BIN && 'Set VIENTO_MOBILE_STORE_BIN to the mobile-storage example',
}, async (t) => {
  const library = await nativeMobileLibrary(process.env.VIENTO_MOBILE_STORE_BIN); t.after(() => library.close());
  const call = (action, args = {}) => library.invoke('mobile_storage', { action, ...args });
  const offered = await call('templates');
  assert.equal(offered.defaultTemplate, catalog.defaultTemplate);
  assert.deepEqual(offered.templates, catalog.templates.map(({ packageId, version, label, description }) => ({ packageId, version, label, description })));
  assert.ok(!offered.templates.some(item => item.packageId === catalog.legacyTemplate));
  const packages = new Map();
  for (const template of catalog.templates) {
    const workspace = await call('create', { payload: { name: template.label, templateId: template.packageId } });
    assert.deepEqual(workspace.documentTypes, template.documentTypes);
    assert.deepEqual(workspace.projectTemplate, { packageId: template.packageId, version: template.version,
      digest: `sha256:${createHash('sha256').update(canonicalJson(template)).digest('hex')}` });
    packages.set(template.packageId, workspace);
    const platform = createMobilePlatform({ invoke: library.invoke, workspaceId: workspace.id });
    assert.equal((await platform.index()).count, 0);
    for (const [file, content] of Object.entries(template.templates)) {
      const response = await platform.request(`/templates/${file}`);
      assert.equal(response.status, 200); assert.equal(await response.text(), content);
    }
  }
  const before = await fs.readdir(library.root);
  for (const templateId of ['unknown.template', '../escape', '', 1, null]) {
    await assert.rejects(call('create', { payload: { name: '错误模板', templateId } }));
    assert.deepEqual(await fs.readdir(library.root), before);
  }
  for (const [packageId, typeId, content] of [
    ['org.viento.oc-game', 'item', '\uFEFF# 解谜道具\r\n自定义容量：0\r\n用途：解谜\r\n'],
    ['org.viento.oc-literature', 'chapter', '\uFEFF# 旅途\r\n\r\n她说：别走。\r\n\r\n他说：我会回来。\r\n'],
    ['org.viento.oc-drama', 'scene', '\uFEFF# 第一场\r\n\r\n（灯光亮起）\r\n\r\n人物甲：别走。\r\n\r\n人物乙：我会回来。\r\n'],
  ]) {
    const work = packages.get(packageId), type = work.documentTypes.find(item => item.id === typeId);
    const sourcePath = `documents/${type.directory}/example.md`;
    await call('save', { workspaceId: work.id, payload: { path: sourcePath, content, create: true, documentType: typeId } });
    const beforeIndex = await createMobilePlatform({ invoke: library.invoke, workspaceId: work.id }).index();
    assert.equal(beforeIndex.docs[0].raw, content);
    if (type.parserProfile === 'prose') assert.deepEqual(Object.keys(beforeIndex.docs[0].fields), ['_header']);
    else assert.equal(beforeIndex.docs[0].fields.自定义容量, '0');
    const archive = path.join(library.root, `${typeId}.viento.zip`);
    await call('exportArchive', { workspaceId: work.id, path: archive });
    const target = await nativeMobileLibrary(process.env.VIENTO_MOBILE_STORE_BIN);
    try {
      const restored = await target.invoke('mobile_storage', { action: 'importArchive', path: archive });
      assert.equal(restored.id, work.id);
      assert.deepEqual(restored.documentTypes, work.documentTypes);
      assert.deepEqual(restored.projectTemplate, work.projectTemplate);
      const afterIndex = await createMobilePlatform({ invoke: target.invoke, workspaceId: restored.id }).index();
      assert.equal(afterIndex.docs[0].raw, content);
      assert.equal(afterIndex.docs[0].id, beforeIndex.docs[0].id);
      assert.deepEqual(afterIndex.docs[0].layout, beforeIndex.docs[0].layout);
    } finally { await target.close(); }
  }
  const software = packages.get('org.viento.software-design');
  const content = '\uFEFF名称: 独立组件\r\n职责: 保真写入\r\n输入: []\r\n输出: []\r\n依赖: []\r\n';
  const source = 'documents/components/one.yaml';
  await call('save', { workspaceId: software.id, payload: { path: source, content, create: true, documentType: 'component' } });
  const platform = createMobilePlatform({ invoke: library.invoke, workspaceId: software.id });
  const snapshot = await call('read', { workspaceId: software.id, path: source });
  const descriptor = resolveDocumentDefinition(software, source, { documentType: 'component' });
  const draft = createDocumentFieldDraft(content, source, descriptor);
  const edited = serializeFieldDraft(content, draft, draft.fields.map(field => field.key === '职责' ? '独立修改' : field.value));
  await call('save', { workspaceId: software.id, payload: { path: source, content: edited, expectedVersion: snapshot.version } });
  assert.equal(edited, content.replace('保真写入', '"独立修改"'));
  const index = await platform.index();
  assert.equal(index.docs[0].title, '独立组件');
  assert.equal(index.docs[0].parserProfile, 'structured');
  assert.equal(index.docs[0].layout.sections[0].title, '组件定义');
  const archive = path.join(library.root, 'software.viento.zip');
  await call('exportArchive', { workspaceId: software.id, path: archive });
  const restoredLibrary = await nativeMobileLibrary(process.env.VIENTO_MOBILE_STORE_BIN); t.after(() => restoredLibrary.close());
  const restored = await restoredLibrary.invoke('mobile_storage', { action: 'importArchive', path: archive });
  assert.equal(restored.id, software.id);
  assert.deepEqual(restored.projectTemplate, software.projectTemplate);
  const restoredIndex = await createMobilePlatform({ invoke: restoredLibrary.invoke, workspaceId: restored.id }).index();
  const { lastModified: beforeTime, ...beforeDoc } = index.docs[0];
  const { lastModified: afterTime, ...afterDoc } = restoredIndex.docs[0];
  assert.deepEqual(afterDoc, beforeDoc);
  assert.deepEqual(restoredIndex.workspace, index.workspace);
  const oldClient = await call('create', { payload: { name: '旧客户端' } });
  assert.deepEqual(oldClient.documentTypes, PROJECT_DEFAULTS.documentTypes);
  const oldSelection = await call('create', { payload: { name: '旧模板标识', templateId: catalog.legacyTemplate } });
  assert.deepEqual(oldSelection.documentTypes, PROJECT_DEFAULTS.documentTypes);
  assert.equal(oldSelection.projectTemplate.digest, 'sha256:30545b1162327ee60172cdbe0255a3f85729f668d036a7ff358be8259fe1dc90');
});
