import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createSceneAudioCreationDraft } from '../../engine/scene-audio-create-plan.mjs';
import { validateDocumentModels } from '../../engine/document-model.mjs';
import { audioPureFixture, id, revision, sceneId } from './helpers/world-audio-create-pure-fixture.mjs';
import { SCENE_AUDIO_CREATION_API_PATH, captureSceneAudioCreationContext, createSceneAudioCreationRequest, validateSceneAudioCreationResult, confirmSceneAudioCreation } from '../../engine/scene-audio-creation-contract.mjs';
const draft=f=>Object.fromEntries(['objectId','documentType','sourcePath','content'].map(key=>[key,f.request[key]]));
const ready=(f,p)=>({...f.context,status:'ready',baseRevision:p.result.revision,scene:{...f.context.scene,objectRevision:p.result.scene.revision},manifest:{objectId:f.request.objectId,objectRevision:p.result.object.revision,sourcePath:f.request.sourcePath,sourceRevision:revision(f.request.content),documentType:f.request.documentType,parserProfile:'structured',content:f.request.content,relations:p.result.changes[0].record.relations,assetBindings:p.result.changes[0].record.assetBindings,trackCount:2}});
test('exact catalog capture accepts real WAV candidates and remains detached deeply frozen',async()=>{const f=await audioPureFixture();assert.equal(SCENE_AUDIO_CREATION_API_PATH,'/api/scene-audio-creation');const c=captureSceneAudioCreationContext(f.context,sceneId);assert.deepEqual(c,f.context);assert.ok(Object.isFrozen(c.resources[0]));f.context.resources[0].name='changed';assert.notEqual(c.resources[0].name,f.context.resources[0].name);const empty={...f.context,resources:[]};assert.equal(captureSceneAudioCreationContext(empty,sceneId).resources.length,0);});
test('catalog rejects absolute traversal unsupported media ambiguous resources and hidden fields',async()=>{const f=await audioPureFixture();for(const mutate of [c=>c.resources[0].sourcePath='/etc/secret.wav',c=>c.resources[0].sourcePath='../other.wav',c=>c.resources[0].sourcePath='a\\b.wav',c=>c.resources[0].sourcePath='https:evil.wav',c=>c.resources[0].sourcePath='tone.mp3',c=>c.resources[0].size=33*1024*1024,c=>c.resources[0].availability='verified',c=>c.resources.push(c.resources[0]),c=>c.resources[0].extra=true,c=>c.extra=true,c=>c.scene.objectId=id(99)]){const c=structuredClone(f.context);mutate(c);assert.throws(()=>captureSceneAudioCreationContext(c,sceneId),{errorCode:'scene_audio_creation_invalid'});}let calls=0;const c=structuredClone(f.context);Object.defineProperty(c.resources[0],'name',{enumerable:true,get(){calls++;return 'bad';}});assert.throws(()=>captureSceneAudioCreationContext(c,sceneId),{errorCode:'scene_audio_creation_invalid'});assert.equal(calls,0);});
test('portable request is bound to saved world scene selected registered resources and exact draft',async()=>{const f=await audioPureFixture();assert.deepEqual(createSceneAudioCreationRequest(f.context,draft(f)),f.request);assert.equal(createSceneAudioCreationRequest(f.context,draft(f),'apply').mode,'apply');for(const mutate of [d=>d.extra=true,d=>d.objectId=sceneId,d=>d.sourcePath='../outside.json',d=>d.documentType='unknown',d=>d.content=d.content.replace(/999/g,'aaa')]){const d=draft(f);mutate(d);if(d.content===f.request.content&&Object.keys(d).length===4&&d.objectId===f.request.objectId&&d.sourcePath===f.request.sourcePath&&d.documentType===f.request.documentType)continue;assert.throws(()=>createSceneAudioCreationRequest(f.context,d),{errorCode:'scene_audio_creation_invalid'});}const d=draft(f),value=JSON.parse(d.content.slice(1));value.tracks[0].resourceId=id(99);d.content=JSON.stringify(value);assert.throws(()=>createSceneAudioCreationRequest(f.context,d),{errorCode:'scene_audio_creation_invalid'});});
test('real pure preview and applied receipt bind complete source registration opt-in and commit identity',async()=>{const f=await audioPureFixture(),p=await f.run(),hash=revision(f.request.content);assert.deepEqual(validateSceneAudioCreationResult(p.result,f.request,f.context,hash),p.result);const request={...f.request,mode:'apply'},result={...structuredClone(p.result),status:'applied',receipt:{format:'viento-transaction-receipt',schemaVersion:1,transactionId:id(90),worldId:f.request.worldId,proposalId:p.result.proposal.id,baseRevision:f.request.baseRevision,revision:p.result.revision,state:'committed'}};assert.deepEqual(validateSceneAudioCreationResult(result,request,f.context,hash),result);for(const mutate of [r=>r.changes[0].afterText+=' ',r=>r.changes[0].record.assetBindings=[],r=>r.changes[0].record.relations.push({kind:'references',targetId:id(99),slot:''}),r=>r.object.documentRefs[0].sourceRevision=revision('other'),r=>r.scene.documentRefs[0].sourceRevision=revision('other'),r=>r.relation.properties.kind='references',r=>r.changes[1].targetObjectId=id(99),r=>r.proposal.commands[0].input.sourcePath='documents/other.json',r=>r.proposal.affectedObjects.reverse(),r=>r.receipt.state='rolled-back',r=>r.extra=true]){const changed=structuredClone(result);mutate(changed);assert.throws(()=>validateSceneAudioCreationResult(changed,request,f.context,hash),{errorCode:'scene_audio_creation_invalid'});}});
test('uncertain creation converges only on exact UUID source revision content and full new dependency closure',async()=>{const f=await audioPureFixture(),p=await f.run(),c=ready(f,p),hash=revision(f.request.content);assert.equal(confirmSceneAudioCreation(c,f.request,hash),true);assert.equal(confirmSceneAudioCreation(f.context,f.request,hash),false);for(const mutate of [c=>c.manifest.objectId=id(99),c=>c.manifest.content+=' ',c=>c.manifest.sourceRevision=revision('other'),c=>c.scene.sourceRevision=revision('other'),c=>c.manifest.sourcePath='documents/else.json',c=>c.manifest.relations.push({kind:'references',targetId:id(99),slot:''}),c=>c.manifest.assetBindings.push({assetId:id(99),role:'extra'})]){const changed=structuredClone(c);mutate(changed);assert.equal(confirmSceneAudioCreation(changed,f.request,hash),false);}});
test('ready navigation retains existing official example reference relation and additional author bindings',async()=>{const f=await audioPureFixture(),p=await f.run(),c=ready(f,p);c.manifest.relations=[{kind:'reference',targetId:sceneId,slot:'scene'},{kind:'references',targetId:id(99),slot:'extra'}];c.manifest.assetBindings.push({assetId:id(99),role:'extra'});assert.deepEqual(captureSceneAudioCreationContext(c,sceneId),c);assert.equal(confirmSceneAudioCreation(c,f.request,revision(f.request.content)),false);const record=JSON.parse(await fs.readFile(new URL('../../examples/scene-audio/metadata/documents/88888888-8888-4888-8888-888888888888.json',import.meta.url),'utf8'));assert.equal(record.relations[0].kind,'reference');assert.equal(record.relations[0].slot,'scene');});


test('ready metadata annotations survive bounded capture without weakening exact creation confirmation or receipt', async () => {
  const f = await audioPureFixture(), p = await f.run(), c = ready(f, p), hash = revision(f.request.content);
  c.manifest.relations[0].note = 'existing author annotation';
  c.manifest.assetBindings[0].extension = { label: 'Original asset usage', tags: ['author', 'audio'] };
  const captured = captureSceneAudioCreationContext(c, sceneId);
  assert.deepEqual(captured, c);
  assert.ok(Object.isFrozen(captured.manifest.assetBindings[0].extension.tags));
  c.manifest.assetBindings[0].extension.tags.push('later');
  assert.equal(captured.manifest.assetBindings[0].extension.tags.length, 2);
  assert.equal(confirmSceneAudioCreation(captured, f.request, hash), false);
  for (const mutate of [
    result => { result.changes[0].record.relations[0].note = 'extra'; },
    result => { result.changes[0].record.assetBindings[0].note = 'extra'; },
  ]) {
    const result = structuredClone(p.result); mutate(result);
    assert.throws(() => validateSceneAudioCreationResult(result, f.request, f.context, hash), { errorCode: 'scene_audio_creation_invalid' });
  }
});

test('ready annotations do not admit getters unbounded metadata or missing dependency fields', async () => {
  const f = await audioPureFixture(), p = await f.run();
  let calls = 0;
  for (const mutate of [
    c => Object.defineProperty(c.manifest.relations[0], 'note', { enumerable: true, get() { calls++; return 'bad'; } }),
    c => Object.defineProperty(c.manifest.assetBindings[0], 'note', { enumerable: true, get() { calls++; return 'bad'; } }),
    c => { c.manifest.relations[0].note = 'x'.repeat(32769); },
    c => { c.manifest.assetBindings[0].note = Array(257).fill('extra'); },
    c => { c.manifest.relations[0].note = {}; let nested = c.manifest.relations[0].note; for (let i = 0; i < 17; i++) nested = nested.child = {}; },
    c => { delete c.manifest.relations[0].targetId; },
    c => { c.manifest.relations[0].kind = '   '; },
    c => { c.manifest.relations[0].slot = 4; },
    c => { c.manifest.assetBindings[0].role = 4; },
    c => { delete c.manifest.assetBindings[0].assetId; },
    c => { c.manifest.relations[0] = null; },
    c => { c.manifest.assetBindings[0] = []; },
  ]) {
    const c = ready(f, p); c.manifest = structuredClone(c.manifest); mutate(c);
    assert.throws(() => captureSceneAudioCreationContext(c, sceneId), { errorCode: 'scene_audio_creation_invalid' });
  }
  assert.equal(calls, 0);
});


test('ready dependency strings follow existing registry rules including empty roles and long author labels', async () => {
  const f = await audioPureFixture(), p = await f.run();
  for (const role of ['', 'music', 'author role '.repeat(24)]) {
    const c = ready(f, p); c.manifest = structuredClone(c.manifest);
    c.manifest.assetBindings[0].role = role;
    c.manifest.relations[0].kind = 'author reference '.repeat(24);
    c.manifest.relations[0].slot = 'author scene slot '.repeat(24);
    const record = { ...p.result.changes[0].record, relations: c.manifest.relations, assetBindings: c.manifest.assetBindings };
    validateDocumentModels([...p.nextSource.documents.filter(item => item.record.id !== record.id).map(item => item.record), record]);
    assert.deepEqual(captureSceneAudioCreationContext(c, sceneId), c);
    assert.equal(confirmSceneAudioCreation(c, f.request, revision(f.request.content)), false);
  }
});

for (const mode of ['mixed', 'behavior']) test(`${mode} creation request and confirmation preserve resources even without a play cue`, async () => {
  const f = await audioPureFixture(), original = JSON.parse(f.request.content.slice(1));
  const planned = createSceneAudioCreationDraft({ sceneObjectId: sceneId, tracks: original.tracks.map((track, index) => {
    const cue = original.cues.find(item => item.trackId === track.id), behavior = mode === 'behavior' || index === 1;
    return { trackId: track.id, cueId: cue.id, resourceId: track.resourceId, role: track.role, volume: track.volume, loop: track.loop,
      startMode: behavior ? 'behavior' : 'timeline', ...(behavior ? {} : { atSeconds: cue.atSeconds }) };
  }) });
  assert.equal(planned.ok, true); f.request.content = planned.content;
  const request = createSceneAudioCreationRequest(f.context, draft(f)); assert.equal(request.content, planned.content);
  const p = await f.run(), hash = revision(request.content), catalog = ready(f, p);
  assert.equal(JSON.parse(planned.content).cues.length, mode === 'behavior' ? 0 : 1);
  assert.deepEqual(validateSceneAudioCreationResult(p.result, request, f.context, hash), p.result);
  assert.equal(confirmSceneAudioCreation(catalog, request, hash), true);
  const missing = structuredClone(catalog); missing.manifest.assetBindings = [];
  assert.throws(() => captureSceneAudioCreationContext(missing, sceneId), { errorCode: 'scene_audio_creation_invalid' });
  const missingCandidate = structuredClone(f.context); missingCandidate.resources = [];
  assert.throws(() => createSceneAudioCreationRequest(missingCandidate, draft(f)), { errorCode: 'scene_audio_creation_invalid' });
});
