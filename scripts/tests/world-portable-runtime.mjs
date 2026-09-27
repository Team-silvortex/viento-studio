import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = new URL('../../engine/', import.meta.url), yaml = new URL('../../node_modules/yaml/browser/', import.meta.url);
const context = vm.createContext({}), modules = new Map();
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
if (process.argv.includes('--changesets')) {
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
