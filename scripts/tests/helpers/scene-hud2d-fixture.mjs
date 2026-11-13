import { sceneCamera2DFixture, cameraId, cameraDigest } from './scene-camera2d-fixture.mjs';
export const hudId = cameraId;
export const hudDigest = cameraDigest;
export const hudLabel = (id = hudId(40)) => ({ id, kind: 'label', anchor: 'top-left', offset: [12, 16], size: [240, 40],
  fontSize: 24, color: '#ffffff', content: { kind: 'state', key: 'score', prefix: 'Score: ', suffix: '', missing: '—' } });
export const hudBar = (id = hudId(41)) => ({ id, kind: 'bar', anchor: 'top-right', offset: [-12, 16], size: [200, 20],
  key: 'health', min: 0, max: 100, fallback: 50, fillColor: '#80d9b6', backgroundColor: '#102030ff' });
export const hudDocument = (elements = [hudLabel(), hudBar()], sceneObjectId = hudId(1)) => ({ format: 'viento-scene-hud2d', schemaVersion: 1, sceneObjectId, elements });
export async function sceneHUD2DFixture({ schemaVersion = 2, enabled = false } = {}) {
  const f = await sceneCamera2DFixture({ enabled: false, schemaVersion });
  if (schemaVersion === 1) { f.declaration.actors = f.declaration.actors.slice(0, 1); f.update(f.scene, f.declaration); }
  const value = hudDocument(undefined, f.sceneId), hud = f.camera;
  hud.record.sourcePath = hud.sourcePath = 'documents/hud/overlay.json'; f.update(hud, value);
  if (enabled) f.scene.record.relations.push({ kind: 'references', targetId: hud.record.id, slot: 'hud2d' });
  const observed = await f.observe();
  const sceneObject = observed.projection.objects.find(item => item.id === f.sceneId);
  const request = { command: 'hud2d.create', mode: 'preview', worldId: observed.projection.world.id, baseRevision: observed.projection.world.revision,
    actorRef: { kind: 'user', id: 'studio-hud2d-create' }, objectId: hudId(80), documentType: 'document', sourcePath: 'documents/hud/new.json', content: '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n',
    sceneObjectId: f.sceneId, sceneObjectRevision: sceneObject.revision, sceneSourceRevision: f.scene.sourceRevision };
  return { ...f, ...observed, value, hud, request,
    sceneRecordContent: '\ufeff' + JSON.stringify(f.scene.record, null, 2).replaceAll('\n', '\r\n') + '\r\n',
    registry: () => ({ documents: f.source.documents.map(doc => doc.record), assets: [] }) };
}
