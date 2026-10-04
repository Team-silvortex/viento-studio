import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = new URL('../../engine/', import.meta.url), yaml = new URL('../../node_modules/yaml/browser/', import.meta.url);
const context = vm.createContext({ TextEncoder, TextDecoder }), modules = new Map();
function load(url) {
  if (!url.href.startsWith(root.href) && !url.href.startsWith(yaml.href)) throw new Error('Host dependency in semantic kernel');
  if (!modules.has(url.href)) modules.set(url.href, new vm.SourceTextModule(fs.readFileSync(url, 'utf8'), { context, identifier: url.href }));
  return modules.get(url.href);
}
const entry = load(new URL('index.mjs', root));
await entry.link((specifier, parent) => load(specifier === 'yaml' ? new URL('index.js', yaml) : new URL(specifier, parent.identifier)));
await entry.evaluate();
const content = '{"count":9007199254740993}';
const input = { workspace: { id: 'portable-project', version: 3, name: 'Portable' }, definition: { documentTypes: [] },
  documents: [{ sourcePath: 'documents/object.json', record: { id: 'portable-object' }, content, sourceRevision: `sha256:${createHash('sha256').update(content).digest('hex')}` }] };
const before = JSON.stringify(input);
const projection = await entry.namespace.createWorldProjection(input, { digest: value => createHash('sha256').update(value).digest('hex') });
if (process.argv.includes('--projection') || process.argv.includes('--projection-update')) {
  const digest = value => createHash('sha256').update(value).digest('hex');
  const core = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const source = { ...input, definition: { paths: { documents: 'documents', templates: 'templates', metadata: 'metadata' },
    documentTypes: [{ id: 'record', label: 'Record', directory: '', parserProfile: 'structured' }] },
    documents: [{ ...input.documents[0], record: { id: core } }], assets: [] };
  const original = JSON.stringify(source), view = await entry.namespace.createWorldProjection(source, { digest });
  const snapshot = entry.namespace.getProjectionTemplates()[0], template = await entry.namespace.lockProjectionTemplate(snapshot, { digest });
  const declaration = { format: 'viento-object-projection', schemaVersion: 1, title: 'Portable', sourceObjectId: core, template,
    configuration: Object.fromEntries(snapshot.fields.map(field => [field.id, field.default])) };
  const plan = await entry.namespace.prepareProjectionCreate(source, view, { command: 'projection.create', mode: 'preview',
    worldId: view.world.id, baseRevision: view.world.revision, actorRef: { kind: 'tool', id: 'portable' },
    objectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', documentType: 'record', sourcePath: 'documents/new.json', content: JSON.stringify(declaration),
  }, { digest });
  if (process.argv.includes('--projection-update')) {
    const updatedView = await entry.namespace.createWorldProjection(plan.nextSource, { digest }), object = plan.result.object;
    const beforeUpdate = JSON.stringify(plan.nextSource);
    const edited = await entry.namespace.prepareProjectionUpdate(plan.nextSource, updatedView, plan.plans[1].afterContent, {
      command: 'projection.update', mode: 'preview', worldId: updatedView.world.id, baseRevision: updatedView.world.revision,
      actorRef: { kind: 'tool', id: 'portable' }, objectId: object.id, objectRevision: object.revision,
      sourceRevision: object.documentRefs[0].sourceRevision, content: JSON.stringify({ ...declaration, title: 'Updated portable' }),
    }, { digest });
    console.log(JSON.stringify({ unchanged: original === JSON.stringify(source) && beforeUpdate === JSON.stringify(plan.nextSource),
      files: edited.plans.length, name: edited.result.object.name,
      metadataUnchanged: edited.plans[1].beforeContent === edited.plans[1].afterContent }));
  } else console.log(JSON.stringify({ unchanged: original === JSON.stringify(source), files: plan.plans.length,
    speed: entry.namespace.renderProjectionRuntime(declaration).speed, core: plan.result.object.provenance.authoredProjection.sourceObjectId }));
} else if (process.argv.includes('--scene') || process.argv.includes('--scene-update')) {
  const digest = value => createHash('sha256').update(value).digest('hex');
  const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const source = { ...input, definition: { paths: { documents: 'documents', templates: 'templates', metadata: 'metadata' },
    documentTypes: [{ id: 'record', label: 'Record', directory: '', parserProfile: 'structured' }] },
    documents: [{ ...input.documents[0], record: { id: actorId } }], assets: [] };
  const original = JSON.stringify(source), view = await entry.namespace.createWorldProjection(source, { digest });
  const scene = { format: 'viento-scene2d', schemaVersion: 1, title: 'Portable scene', viewport: [800, 480], background: '#000000',
    actors: [{ objectId: actorId, position: [20, 20], size: [40, 40], color: '#ffffff', speed: 100, controls: 'arrows' }] };
  const plan = await entry.namespace.prepareSceneCreate(source, view, { command: 'scene.create', mode: 'preview',
    worldId: view.world.id, baseRevision: view.world.revision, actorRef: { kind: 'tool', id: 'portable' },
    objectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', documentType: 'record', sourcePath: 'documents/new.json', content: JSON.stringify(scene),
  }, { digest });
  if (process.argv.includes('--scene-update')) {
    const next = await entry.namespace.createWorldProjection(plan.nextSource, { digest }), object = plan.result.object, beforeUpdate = JSON.stringify(plan.nextSource);
    const updated = await entry.namespace.prepareSceneUpdate(plan.nextSource, next, plan.plans[1].afterContent, {
      command: 'scene.update', mode: 'preview', worldId: next.world.id, baseRevision: next.world.revision,
      actorRef: { kind: 'tool', id: 'portable' }, objectId: object.id, objectRevision: object.revision,
      sourceRevision: object.documentRefs[0].sourceRevision, content: JSON.stringify({ ...scene, title: 'Updated portable scene' }),
    }, { digest });
    console.log(JSON.stringify({ unchanged: original === JSON.stringify(source) && beforeUpdate === JSON.stringify(plan.nextSource),
      files: updated.plans.length, title: JSON.parse(updated.plans[0].afterContent).title,
      metadataUnchanged: updated.plans[1].beforeContent === updated.plans[1].afterContent }));
  } else console.log(JSON.stringify({ kind: plan.kind, unchanged: original === JSON.stringify(source), files: plan.plans.length,
    actors: plan.result.changes[0].record.relations.length }));
} else if (process.argv.includes('--resources')) {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', assetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const recordContent = `{"id":"${id}","assetBindings":[],"extension":9007199254740993}`;
  const source = { ...input, documents: [{ ...input.documents[0], record: JSON.parse(recordContent) }],
    assets: [{ record: { id: assetId, name: 'Reference', kind: 'image' }, availability: 'missing' }] };
  const original = JSON.stringify(source), digest = value => createHash('sha256').update(value).digest('hex');
  const view = await entry.namespace.createWorldProjection(source, { digest });
  const plan = await entry.namespace.prepareResourceBind(source, view, recordContent, { command: 'resource.bind', mode: 'preview',
    worldId: view.world.id, baseRevision: view.world.revision, actorRef: { kind: 'tool', id: 'portable' },
    objectId: id, objectRevision: view.objects[0].revision, resourceId: assetId, resourceRevision: view.resources[0].revision, slot: 'portrait',
  }, { digest });
  console.log(JSON.stringify({ slot: plan.result.binding.slot,
    largeNumberPreserved: plan.plans[0].afterContent.includes('9007199254740993'), unchanged: original === JSON.stringify(source) }));
} else if (process.argv.includes('--relations')) {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', targetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const recordContent = `{"id":"${id}","relations":[],"extension":9007199254740993}`;
  const source = { ...input, assets: [], documents: [
    { ...input.documents[0], record: JSON.parse(recordContent) },
    { ...input.documents[0], sourcePath: 'documents/target.json', record: { id: targetId, relations: [] } },
  ] };
  const original = JSON.stringify(source), digest = value => createHash('sha256').update(value).digest('hex');
  const view = await entry.namespace.createWorldProjection(source, { digest });
  const plan = await entry.namespace.prepareRelationAdd(source, view, recordContent, { command: 'relation.add', mode: 'preview',
    worldId: view.world.id, baseRevision: view.world.revision, actorRef: { kind: 'tool', id: 'portable' },
    objectId: id, objectRevision: view.objects.find(item => item.id === id).revision,
    targetObjectId: targetId, targetRevision: view.objects.find(item => item.id === targetId).revision,
    kind: 'references', slot: '',
  }, { digest });
  console.log(JSON.stringify({ kind: plan.result.relation.properties.kind,
    largeNumberPreserved: plan.plans[0].afterContent.includes('9007199254740993'), unchanged: original === JSON.stringify(source) }));
} else if (process.argv.includes('--create')) {
  const source = { ...input, definition: { paths: { documents: 'documents', templates: 'templates', metadata: 'metadata' },
    documentTypes: [{ id: 'record', label: 'Record', directory: '', parserProfile: 'structured' }] } };
  const original = JSON.stringify(source);
  const view = await entry.namespace.createWorldProjection(source, { digest: value => createHash('sha256').update(value).digest('hex') });
  const plan = await entry.namespace.prepareObjectCreate(source, view, { command: 'object.create', mode: 'preview',
    worldId: view.world.id, baseRevision: view.world.revision, actorRef: { kind: 'tool', id: 'portable' },
    objectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', documentType: 'record', sourcePath: 'documents/new.json', content,
  }, { digest: value => createHash('sha256').update(value).digest('hex') });
  console.log(JSON.stringify({ value: plan.result.object.properties['field-0'].value, unchanged: original === JSON.stringify(source), files: plan.plans.length }));
} else if (process.argv.includes('--changesets')) {
  const object = projection.objects[0];
  const plan = await entry.namespace.prepareChangeSet(input, projection, { command: 'changeset.apply', mode: 'preview',
    worldId: projection.world.id, baseRevision: projection.world.revision, actorRef: { kind: 'tool', id: 'portable' },
    commands: [{ command: 'property.set', objectId: object.id, objectRevision: object.revision,
      sourceRevision: object.documentRefs[0].sourceRevision, propertyPath: '/properties/field-0', value: '9007199254740995' }],
  }, { digest: value => createHash('sha256').update(value).digest('hex') });
  console.log(JSON.stringify({ after: plan.plans[0].afterContent, inverse: plan.result.inverseCommand.commands[0].value,
    proposal: plan.result.proposal.state, unchanged: before === JSON.stringify(input) }));
} else if (process.argv.includes('--commands')) {
  const object = projection.objects[0];
  const plan = await entry.namespace.preparePropertySet(projection, content, { command: 'property.set', mode: 'preview',
    worldId: projection.world.id, baseRevision: projection.world.revision, objectId: object.id, objectRevision: object.revision,
    sourceRevision: object.documentRefs[0].sourceRevision, propertyPath: '/properties/field-0', value: '9007199254740995', actorRef: { kind: 'tool', id: 'portable' },
  }, { digest: value => createHash('sha256').update(value).digest('hex') });
  console.log(JSON.stringify({ after: plan.afterContent, proposal: plan.proposal.state, unchanged: before === JSON.stringify(input) }));
} else console.log(JSON.stringify({ objects: projection.objects.length, value: projection.objects[0].properties['field-0'].value, unchanged: before === JSON.stringify(input) }));
