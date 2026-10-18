import test from 'node:test';
import assert from 'node:assert/strict';
import { animationPureFixture, id, revision, sceneId, actorId, manifestId, instanceA, instanceB } from './helpers/world-animation-create-pure-fixture.mjs';
import { captureSceneAnimationPreview, resolveSceneAnimationPreview, isSceneAnimationPreview } from '../../engine/scene-animation-preview.mjs';
const invalid = { errorCode: 'scene_animation_preview_invalid' };
const copy = structuredClone;
async function fixture({ existing = true, legacy = false } = {}) {
  const f = await animationPureFixture(), p = existing ? await f.run() : null, source = p?.nextSource || f.source;
  const scene = source.documents.find(item => item.record.id === sceneId);
  const authored = JSON.parse(scene.content.slice(1));
  const actors = (legacy ? authored.actors.slice(0, 1) : authored.actors).map(actor => { const result = { ...actor }; if (legacy) delete result.instanceId; return result; });
  const plan = { format: 'viento-build-plan', kind: 'scene2d', schemaVersion: legacy ? 1 : 2,
    scene: { objectId: sceneId, sourcePath: scene.sourcePath, sourceRevision: scene.sourceRevision, viewport: [640,480], title: 'Real scene' }, actors };
  const snapshotId = revision('frozen static scene and images');
  const resolve = () => resolveSceneAnimationPreview({ source }, plan, snapshotId);
  const preview = () => ({ ok: true, format: 'viento-scene-preview', schemaVersion: plan.schemaVersion, snapshotId,
    previewId: id(90), scene: plan.scene, actors: plan.actors, resources: [], animationPreview: resolve() });
  return { ...f, source, plan, snapshotId, resolve, preview, manifest: source.documents.find(item => item.record.id === manifestId) };
}
test('resolver binds ready animation to the frozen scene and preview captures a detached branded catalog', async () => {
  const f=await fixture(),before=JSON.stringify(f.source),envelope=f.resolve(),catalog=captureSceneAnimationPreview(f.preview());
  assert.equal(envelope.status,'ready');assert.equal(envelope.snapshotId,f.snapshotId);assert.equal(envelope.manifest.objectId,manifestId);
  assert.deepEqual(envelope.scene,{objectId:sceneId,sourcePath:f.scene.sourcePath,sourceRevision:f.scene.sourceRevision});assert.equal(envelope.document.tracks.length,2);
  assert.equal(JSON.stringify(f.source),before);assert.ok(Object.isFrozen(envelope.document.tracks[0].keyframes[0].value));
  assert.deepEqual(Object.keys(catalog),['status','snapshotId','scene','manifest','document','diagnostics']);assert.equal(isSceneAnimationPreview(catalog),true);assert.equal(isSceneAnimationPreview(copy(catalog)),false);
  f.manifest.content='bad future source';assert.equal(catalog.document.tracks.length,2);assert.ok(Object.isFrozen(catalog));
});
for(const legacy of [false,true])test(`no animation leaves schema${legacy?1:2} static scenes available without invoking animation validation`,async()=>{
  const f=await fixture({existing:false,legacy}),envelope=f.resolve(),c=captureSceneAnimationPreview(f.preview());
  assert.equal(envelope.status,'none');assert.equal(c.status,'none');assert.equal(c.manifest,null);assert.equal(c.document,null);assert.deepEqual(c.diagnostics,[]);
});
test('legacy scene with an animation relation is invalid but returns a safe source diagnostic',async()=>{
  const f=await fixture({legacy:true}),envelope=f.resolve();assert.equal(envelope.status,'invalid');assert.equal(envelope.document,null);assert.equal(envelope.diagnostics[0].objectId,sceneId);assert.equal(captureSceneAnimationPreview(f.preview()).status,'invalid');
});
test('dangling duplicate self and actor-directed selections become invalid optional attachments',async()=>{
  for(const targets of [[id(99)],[manifestId,manifestId],[sceneId],[actorId]]){
    const f=await fixture(),scene=f.source.documents.find(item=>item.record.id===sceneId);scene.record.relations=targets.map(targetId=>({kind:'animation',targetId,slot:''}));
    const e=f.resolve();assert.equal(e.status,'invalid');assert.equal(e.document,null);assert.ok(e.diagnostics.length>0);assert.equal(captureSceneAnimationPreview(f.preview()).status,'invalid');
  }
});
test('malformed JSON missing backlink wrong scene and removed instance remain explicit animation diagnostics',async()=>{
  for(const mutate of [f=>f.manifest.content='{bad',f=>f.manifest.record.relations=[],f=>f.manifest.record.relations[0].kind='part-of',f=>f.manifest.record.sourcePath='documents/wrong.json',f=>f.manifest.sourceRevision=null,f=>f.manifest.content=null,
    f=>{const d=JSON.parse(f.manifest.content.slice(1));d.sceneObjectId=id(99);f.manifest.content=JSON.stringify(d);},f=>{f.plan.actors.pop();}]){
    const f=await fixture();mutate(f);const e=f.resolve();assert.equal(e.status,'invalid');assert.equal(e.document,null);assert.ok(e.diagnostics.every(d=>d.code==='build_animation_invalid'));assert.equal(captureSceneAnimationPreview(f.preview()).status,'invalid');
  }
});
test('diagnostics are bounded and retain only verified manifest or scene source locations',async()=>{
  const f=await fixture(),d=JSON.parse(f.manifest.content.slice(1));d.tracks[0].instanceId=id(99);f.manifest.content=JSON.stringify(d);
  const e=f.resolve(),issue=e.diagnostics[0];assert.equal(issue.objectId,manifestId);assert.equal(issue.propertyPath,'/tracks/0/instanceId');assert.equal(issue.sourceRevision,f.manifest.sourceRevision);
  assert.deepEqual(Object.keys(issue),['severity','code','message','objectId','sourcePath','sourceRevision','propertyPath']);assert.ok(issue.message.length<=512);assert.ok(Object.isFrozen(issue));
  f.manifest.content=' '.repeat(131073);assert.equal(f.resolve().status,'invalid');
});
test('source resolver never evaluates source record content or relation accessors',async()=>{
  let calls=0;
  for(const mutate of [f=>Object.defineProperty(f.manifest,'content',{enumerable:true,get(){calls++;return '{}';}}),f=>Object.defineProperty(f.manifest.record,'relations',{enumerable:true,get(){calls++;return [];}}),f=>Object.defineProperty(f.source.documents[0].record,'id',{enumerable:true,get(){calls++;return actorId;}})]){
    const f=await fixture();mutate(f);assert.equal(f.resolve().status,'invalid');
  }
  assert.equal(calls,0);
});
test('source resolver reads only animation closure and does not inspect renderer resources behavior or audio content',async()=>{
  const f=await fixture();let calls=0;
  for(const key of ['assets','definition','workspace'])Object.defineProperty(f.source,key,{enumerable:true,get(){calls++;throw Error('unrelated source');}});
  Object.defineProperty(f.source.documents[0],'content',{enumerable:true,get(){calls++;throw Error('actor source');}});
  Object.defineProperty(f.plan.actors[0],'size',{enumerable:true,get(){calls++;throw Error('renderer');}});
  assert.equal(f.resolve().status,'ready');assert.equal(calls,0);
});
test('unavailable static source identities throw rather than fabricate a reusable snapshot',async()=>{
  const f=await fixture();for(const mutate of [p=>p.scene.objectId='bad',p=>p.scene.sourceRevision='bad',p=>p.scene.sourcePath='/secret.json',p=>p.schemaVersion=0,p=>p.kind='scene3d',p=>p.format='unknown',p=>p.actors[0].objectId=sceneId,p=>p.actors[1].instanceId=instanceA]){
    const plan=copy(f.plan);mutate(plan);assert.throws(()=>resolveSceneAnimationPreview({source:f.source},plan,f.snapshotId),invalid);
  }
  assert.throws(()=>resolveSceneAnimationPreview({source:f.source},f.plan,'snapshot:bad'),invalid);
  const stale=copy(f.plan);stale.scene.sourceRevision=revision('stale');assert.equal(resolveSceneAnimationPreview({source:f.source},stale,f.snapshotId).status,'invalid');
});
test('transport binds exact snapshot and scene locations before exposing playback',async()=>{
  const f=await fixture();for(const mutate of [p=>delete p.animationPreview,p=>p.ok=false,p=>p.format='other',p=>p.schemaVersion=3,p=>p.snapshotId='bad',p=>p.animationPreview.snapshotId=revision('other'),p=>p.animationPreview.scene.sourceRevision=revision('other'),p=>p.animationPreview.scene.sourcePath='documents/other.json',p=>p.animationPreview.scene.objectId=id(99),p=>p.animationPreview.extra=true,p=>p.animationPreview.manifest.extra=true,p=>p.animationPreview.scene.extra=true]){
    const p=copy(f.preview());mutate(p);assert.throws(()=>captureSceneAnimationPreview(p),invalid);
  }
});
test('draft and composition payloads cannot become saved animation playback even when fields are undefined',async()=>{
  const f=await fixture();for(const key of ['draft','composition'])for(const value of [undefined,null,{}])assert.throws(()=>captureSceneAnimationPreview({...f.preview(),[key]:value}),invalid);
});
test('ready transport requires stable unique instance membership and keeps repeated definition instances distinct',async()=>{
  const f=await fixture();assert.equal(captureSceneAnimationPreview(f.preview()).status,'ready');
  for(const mutate of [p=>p.actors=[],p=>p.actors[1].instanceId=instanceA,p=>p.actors[0].instanceId=id(99),p=>p.actors[0].objectId='bad',p=>p.actors[0].objectId=sceneId,p=>p.animationPreview.document.sceneObjectId=id(99),p=>p.animationPreview.document.tracks[0].instanceId=id(99),p=>p.animationPreview.document.tracks[0].keyframes[0].value=[20000,0],p=>p.animationPreview.manifest.objectId=actorId,p=>p.animationPreview.manifest.sourcePath=p.scene.sourcePath,p=>p.animationPreview.manifest.objectId=sceneId]){
    const p=copy(f.preview());mutate(p);assert.throws(()=>captureSceneAnimationPreview(p),invalid);
  }
  const legacy=copy(f.preview());legacy.schemaVersion=1;legacy.actors.forEach(actor=>delete actor.instanceId);assert.throws(()=>captureSceneAnimationPreview(legacy),invalid);
});
test('status fields cannot carry contradictory content diagnostics or fabricated locations',async()=>{
  const f=await fixture(),base=f.preview(),bad=f.preview();bad.animationPreview={...bad.animationPreview,status:'invalid',document:null,diagnostics:[{severity:'error',code:'build_animation_invalid',message:'broken',...bad.animationPreview.manifest,propertyPath:'/tracks/0'}]};
  assert.equal(captureSceneAnimationPreview(bad).status,'invalid');
  for(const mutate of [e=>e.status='none',e=>e.status='unknown',e=>e.document=null,e=>e.diagnostics=[...bad.animationPreview.diagnostics],e=>e.manifest=null]){
    const p=copy(base);mutate(p.animationPreview);assert.throws(()=>captureSceneAnimationPreview(p),invalid);
  }
  for(const mutate of [d=>d.objectId=id(99),d=>d.sourcePath='documents/forged.json',d=>d.sourceRevision=revision('forged'),d=>d.extra=true,d=>d.code='untrusted',d=>d.severity='warning',d=>d.propertyPath='no-pointer',d=>d.message='x'.repeat(513)]){
    const p=copy(bad);mutate(p.animationPreview.diagnostics[0]);assert.throws(()=>captureSceneAnimationPreview(p),invalid);
  }
  const empty=copy(bad);empty.animationPreview.diagnostics=[];assert.throws(()=>captureSceneAnimationPreview(empty),invalid);
});
test('transport does not evaluate getters in necessary fields or document and ignores unrelated static capabilities',async()=>{
  const f=await fixture();let calls=0;
  for(const mutate of [p=>Object.defineProperty(p,'snapshotId',{enumerable:true,get(){calls++;return f.snapshotId;}}),p=>Object.defineProperty(p.animationPreview.document,'tracks',{enumerable:true,get(){calls++;return [];}}),p=>Object.defineProperty(p.actors[0],'instanceId',{enumerable:true,get(){calls++;return instanceA;}}),p=>Object.defineProperty(p.animationPreview,'diagnostics',{enumerable:true,get(){calls++;return [];}})]){
    const p=copy(f.preview());mutate(p);assert.throws(()=>captureSceneAnimationPreview(p),invalid);
  }
  const p=f.preview();for(const key of ['resources','sceneEditing','sourceLocations'])Object.defineProperty(p,key,{enumerable:true,get(){calls++;throw Error('unused');}});
  Object.defineProperty(p.scene,'viewport',{enumerable:true,get(){calls++;throw Error('unused viewport');}});assert.equal(captureSceneAnimationPreview(p).status,'ready');assert.equal(calls,0);
});
test('transport refuses malformed unicode prototypes aliases sparse arrays and serializers without invoking them',async()=>{
  const f=await fixture();let calls=0;
  for(const mutate of [p=>p.animationPreview.manifest.sourcePath='documents/\ud800.json',p=>p.animationPreview.manifest.sourcePath='documents/../other.json',p=>p.animationPreview.manifest.sourcePath='documents\\other.json',p=>Object.setPrototypeOf(p.animationPreview,{}),p=>p.animationPreview[Symbol('extra')]=true,p=>delete p.actors[0],p=>p.actors.extra=true,p=>p.animationPreview.document.toJSON=()=>{calls++;return {};},p=>p.animationPreview.document.tracks[0].keyframes[0].value.toJSON=()=>{calls++;return [];}]){
    const p=copy(f.preview());mutate(p);assert.throws(()=>captureSceneAnimationPreview(p),invalid);
  }
  Object.defineProperty(Object.prototype,'toJSON',{configurable:true,value(){calls++;return {};}});
  try{assert.throws(()=>captureSceneAnimationPreview({}),invalid);}finally{delete Object.prototype.toJSON;}
  assert.equal(calls,0);
});
test('document transport budgets prevent overgrown arrays and recursive caller structures',async()=>{
  const f=await fixture();for(const mutate of [p=>p.animationPreview.document.tracks=Array(513).fill(p.animationPreview.document.tracks[0]),p=>p.animationPreview.document.recursive=p.animationPreview.document,p=>p.animationPreview.document.extra='x'.repeat(131073),p=>p.animationPreview.diagnostics=Array(33).fill({})]){
    const p=copy(f.preview());mutate(p);assert.throws(()=>captureSceneAnimationPreview(p),invalid);
  }
});
