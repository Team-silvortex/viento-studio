import '../../adapters/node-studio-core.mjs';
import { createHash } from 'node:crypto';
import { createProjectModel } from '../../../engine/project.mjs';
import { createWorldProjection } from '../../../engine/world-projection.mjs';
import { preparePhysics2DCreate } from '../../../engine/world-physics2d-create.mjs';
export const id = value => `${value.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
export const digest = value => createHash('sha256').update(value).digest('hex');
export const revision = value => `sha256:${digest(value)}`;
export const actorId = id(1), sceneId = id(2), scriptId = id(3), manifestId = id(4), instanceA = id(5), instanceB = id(6);
export const manifest = () => ({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: sceneId,
  bodies: [0, 1].map(index => ({ id: id(40 + index), instanceId: index ? instanceB : instanceA,
    kind: index ? 'sensor' : 'character', shape: index ? { kind: 'circle', radius: 10 } : { kind: 'box', size: [20, 20] },
    offset: [0, 0], layer: 1, mask: 1 })) });

export async function physics2dPureFixture(version = 3, schemaVersion = 2) {
  const workspace = { format: 'viento-workspace', version, id: id(99), name: 'Synthetic physics2d creation', createdAt: 1,
    documentTypes: [{ id: 'document', label: 'Document', directory: '', parserProfile: 'structured' }] };
  const model = createProjectModel({ paths: { documents: 'documents', templates: 'templates', metadata: 'metadata' }, documentTypes: workspace.documentTypes, templates: {} });
  const definition = model.projectDefinition(workspace), root = definition.paths.documents;
  const document = (objectId, relative, content, relations = []) => {
    const sourcePath = `${root}/${relative}`, record = { format: 'viento-document', version: 1, id: objectId, sourcePath,
      documentType: 'document', parserProfile: 'structured', relations, assetBindings: [] };
    return { record, sourcePath, content, sourceRevision: revision(content), descriptor: model.resolveDocumentDefinition(workspace, sourcePath, record) };
  };
  const declaration = { format: 'viento-scene2d', schemaVersion, title: 'Repeated actors', viewport: [640, 480], background: '#0d1829',
    ...(schemaVersion === 3 ? { groups: [] } : {}), actors: [instanceA, instanceB].map(instanceId => ({ instanceId, objectId: actorId,
      position: [20, 30], size: [20, 20], color: '#ffffff', speed: 0, controls: 'none' })) };
  const scene = document(sceneId, 'scenes/demo.json', '\uFEFF' + JSON.stringify(declaration, null, 2).replaceAll('\n', '\r\n') + '\r\n',
    [{ kind: 'references', targetId: actorId, slot: 'definition' }]);
  const sceneRecordContent = '\uFEFF' + JSON.stringify(scene.record, null, 2).replace('"assetBindings": []', '"assetBindings": [], "extension": {"count":9007199254740993,"text":"\\u4e2d","number":1e2}')
    .replaceAll('\n', '\r\n') + '\r\n';
  scene.record = JSON.parse(sceneRecordContent.slice(1)); scene.descriptor = model.resolveDocumentDefinition(workspace, scene.sourcePath, scene.record);
  const source = { workspace, definition, documents: [document(actorId, 'actors/traveler.md', '# Traveler\n\nLife: 100\n'), scene,
    document(scriptId, 'scripts/checkpoint.txt', '\uFEFFextends Node\r\n# this is author data, never executed\r\n')], assets: [] };
  const projection = await createWorldProjection(source, { digest }), sceneObject = projection.objects.find(object => object.id === sceneId);
  const content = '\uFEFF' + JSON.stringify(manifest(), null, 2).replaceAll('\n', '\r\n') + '\r\n';
  const request = { command: 'physics2d.create', mode: 'preview', worldId: projection.world.id, baseRevision: projection.world.revision,
    actorRef: { kind: 'user', id: 'studio-physics2d-create' }, objectId: manifestId, documentType: 'document', sourcePath: `${root}/physics2ds/demo.json`, content,
    sceneObjectId: sceneId, sceneObjectRevision: sceneObject.revision, sceneSourceRevision: scene.sourceRevision };
  const registry = () => ({ documents: source.documents.map(document => document.record), assets: source.assets.map(item=>item.record) });
  const context = { format: 'viento-physics2d-creation-context', schemaVersion: 1, status: 'empty', worldId: projection.world.id,
    baseRevision: projection.world.revision, documentRoot: root, documentTypes: [{ id: 'document', label: 'Document' }],
    scene: { objectId: sceneId, objectRevision: sceneObject.revision, sourcePath: scene.sourcePath, sourceRevision: scene.sourceRevision },
    manifest: null, targets: [instanceA, instanceB].map(instanceId => ({ instanceId, objectId: actorId,
      name: projection.objects.find(object => object.id === actorId).name, sourcePath: `${root}/actors/traveler.md` })) };
  return { source, projection, request, context, sceneRecordContent, scene, registry,
    run: (patch = {}, options = { digest }) => preparePhysics2DCreate(source, projection, sceneRecordContent, { ...request, ...patch }, options) };
}
