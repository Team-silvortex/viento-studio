import { createHash } from 'node:crypto';
import { createProjectModel } from '../../../engine/project.mjs';
import { createWorldProjection } from '../../../engine/world-projection.mjs';
export const cameraId = n => `91919191-9191-4919-8919-${String(n).padStart(12, '0')}`;
export const cameraDigest = value => createHash('sha256').update(value).digest('hex');
export const cameraJson = value => JSON.stringify(value, null, 2) + '\n';
export async function sceneCamera2DFixture({ enabled = true, follow = true, schemaVersion = 2 } = {}) {
  const sceneId = cameraId(1), cameraDocumentId = cameraId(2), definitionId = cameraId(3), assemblyId = cameraId(4), instances = [cameraId(10), cameraId(11)];
  const workspace = { format: 'viento-workspace', version: 3, id: cameraId(99), name: 'Camera fixture', createdAt: 1,
    paths: { documents: 'documents', templates: 'templates', metadata: 'metadata' }, assetStores: { main: { path: 'assets' } },
    documentTypes: [{ id: 'document', label: 'Document', directory: '', parserProfile: 'structured' }] };
  const project = createProjectModel({ paths: { documents: 'documents', templates: 'templates', metadata: 'metadata' }, documentTypes: workspace.documentTypes, templates: {} });
  const document = (id, sourcePath, value, relations = []) => {
    const content = typeof value === 'string' ? value : cameraJson(value);
    const record = { format: 'viento-document', version: 1, id, sourcePath, documentType: 'document', parserProfile: 'structured', relations, assetBindings: [] };
    return { record, sourcePath, content, sourceRevision: `sha256:${cameraDigest(content)}`, descriptor: project.resolveDocumentDefinition(workspace, sourcePath, record) };
  };
  const declaration = { format: 'viento-scene2d', schemaVersion, title: 'World camera', viewport: [640, 480], background: '#182838',
    ...(schemaVersion === 3 ? { groups: [] } : {}), actors: instances.map((instanceId, index) => ({ ...(schemaVersion === 1 ? {} : { instanceId }), objectId: definitionId,
      position: [index ? 1500 : -100, index ? 900 : -80], size: [40, 40], color: '#81d9bc', speed: index ? 0 : 120, controls: index ? 'none' : 'arrows' })) };
  const value = { format: 'viento-scene-camera2d', schemaVersion: 1, sceneObjectId: sceneId,
    camera: follow ? { mode: 'follow', targetInstanceId: instances[1], offset: [-24, 16], zoom: 2 } : { mode: 'fixed', center: [-100, 800], zoom: 0.5 } };
  const scene = document(sceneId, 'documents/scenes/world.json', declaration, [{ kind: 'references', targetId: definitionId, slot: 'definition' },
    ...(enabled ? [{ kind: 'references', targetId: cameraDocumentId, slot: 'camera2d' }] : [])]);
  const camera = document(cameraDocumentId, 'documents/cameras/world.json', value, [{ kind: 'references', targetId: sceneId, slot: 'scene' }]);
  const assembly = document(assemblyId, 'documents/projects/world.json', { format: 'viento-project-assembly', schemaVersion: 1,
    title: 'Camera project', sceneIds: [sceneId], entrySceneId: sceneId }, [{ kind: 'references', targetId: sceneId, slot: 'scene' }]);
  const source = { workspace, definition: project.projectDefinition(workspace), documents: [scene, camera, assembly, document(definitionId, 'documents/actors/traveler.md', '# Traveler\n')], assets: [] };
  const observe = async () => ({ source, projection: await createWorldProjection(source, { digest: cameraDigest }) });
  const update = (target, input) => { target.content = typeof input === 'string' ? input : cameraJson(input); target.sourceRevision = `sha256:${cameraDigest(target.content)}`; };
  return { ...(await observe()), sceneId, cameraDocumentId, definitionId, assemblyId, instances, scene, camera, assembly, value, declaration, observe, update };
}
