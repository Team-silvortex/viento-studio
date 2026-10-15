import '../../adapters/node-studio-core.mjs';
import { createHash } from 'node:crypto';
import { createProjectModel } from '../../../engine/project.mjs';
import { createWorldProjection } from '../../../engine/world-projection.mjs';
import { prepareAudioCreate } from '../../../engine/world-audio-create.mjs';
export const id = value => `${value.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
export const digest = value => createHash('sha256').update(value).digest('hex');
export const revision = value => `sha256:${digest(value)}`;
const clone = value => structuredClone(value);
export const actorId = id(1), sceneId = id(2), scriptId = id(3), manifestId = id(4), instanceA = id(5), instanceB = id(6);
export const resourceId = id(30);
export const manifest = () => ({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: sceneId,
  tracks: [0,1].map(index => ({ id: id(40+index), resourceId, role:index?'effect':'music', volume:index?.5:0, loop:!index })),
  cues: [0,1].map(index => ({id:id(50+index),trackId:id(40+index),atSeconds:index*.25,action:'play'})) });

export async function audioPureFixture(version = 3, schemaVersion = 2) {
  const workspace = { format: 'viento-workspace', version, id: id(99), name: 'Synthetic audio creation', createdAt: 1,
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
    document(scriptId, 'scripts/checkpoint.txt', '\uFEFFextends Node\r\n# this is author data, never executed\r\n')], assets: [{ record: { format:'viento-asset',version:1,id:resourceId,name:'Synthetic tone',kind:'audio',tags:[],location:{store:'main',path:'tone.wav'},content:{size:44,sha256:digest('synthetic fixture bytes')},legacyPaths:[] },availability:'present-unverified' }] };
  const projection = await createWorldProjection(source, { digest }), sceneObject = projection.objects.find(object => object.id === sceneId);
  const content = '\uFEFF' + JSON.stringify(manifest(), null, 2).replaceAll('\n', '\r\n') + '\r\n';
  const request = { command: 'audio.create', mode: 'preview', worldId: projection.world.id, baseRevision: projection.world.revision,
    actorRef: { kind: 'user', id: 'studio-audio-create' }, objectId: manifestId, documentType: 'document', sourcePath: `${root}/audios/demo.json`, content,
    sceneObjectId: sceneId, sceneObjectRevision: sceneObject.revision, sceneSourceRevision: scene.sourceRevision };
  const registry = () => ({ documents: source.documents.map(document => document.record), assets: source.assets.map(item=>item.record) });
  const resource=projection.resources.find(item=>item.id===resourceId);
  const context={format:'viento-audio-creation-context',schemaVersion:1,status:'empty',worldId:projection.world.id,baseRevision:projection.world.revision,documentRoot:root,documentTypes:[{id:'document',label:'Document'}],scene:{objectId:sceneId,objectRevision:sceneObject.revision,sourcePath:scene.sourcePath,sourceRevision:scene.sourceRevision},manifest:null,resources:[{resourceId,resourceRevision:resource.revision,name:'Synthetic tone',sourcePath:'tone.wav',sha256:source.assets[0].record.content.sha256,size:44,availability:'unverified'}]};
  return { source, projection, request, context, sceneRecordContent, scene, registry,
    run: (patch = {}, options = { digest }) => prepareAudioCreate(source, projection, sceneRecordContent, { ...request, ...patch }, options) };
}
