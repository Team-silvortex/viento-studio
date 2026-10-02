import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = new URL('../../engine/', import.meta.url), yaml = new URL('../../node_modules/yaml/browser/', import.meta.url);
const context = vm.createContext({ TextEncoder }), modules = new Map();
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
if (process.argv.includes('--resources')) {
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
