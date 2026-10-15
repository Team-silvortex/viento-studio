import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { audioPureFixture, id, revision } from './helpers/world-audio-create-pure-fixture.mjs';
import { createSceneAudioCreationDraft } from '../../engine/scene-audio-create-plan.mjs';
import { captureSceneAudioCreationContext, createSceneAudioCreationRequest, validateSceneAudioCreationResult, confirmSceneAudioCreation } from '../../engine/scene-audio-creation-contract.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy = value => JSON.parse(JSON.stringify(value));
const bridge = fn => (...args) => fn(...args.map(value => value === undefined ? undefined : copy(value)));
async function settle() { for (let i = 0; i < 4; i++) { await flushDialogs(); await new Promise(resolve => setTimeout(resolve, 2)); } }
async function harness(options = {}) {
  const fixture = await audioPureFixture(); let catalog = copy(options.catalog || fixture.context), locale = 'zh-CN', uuidCount = 0;
  const context = { editable:true, dirty:false, creating:false, busy:false, visible:true, sceneId:fixture.context.scene.objectId, session:'one', sourceToken:'source-one', ...options.context };
  const requests = [], reads = [], applied = [], opened = [], busy = [], languages = [];
  const h = await dialogHarness('app-scene-audio-create', { crypto: { subtle:webcrypto.subtle, randomUUID:() => { uuidCount++; return id(100 + uuidCount); } },
    createSceneAudioCreationDraft:bridge(createSceneAudioCreationDraft), captureSceneAudioCreationContext:bridge(captureSceneAudioCreationContext),
    createSceneAudioCreationRequest:bridge(createSceneAudioCreationRequest), validateSceneAudioCreationResult:bridge(validateSceneAudioCreationResult), confirmSceneAudioCreation:bridge(confirmSceneAudioCreation),
    t:(key,...args) => (locale === 'en' ? en[key] || key : locale === 'ja' ? ja[key] || key : key).replace(/\{(\d+)\}/g, (_,i) => String(args[i])), onLanguageChange:fn => languages.push(fn) });
  const controller = h.runtime.setupSceneAudioCreate({ getContext:() => context, setBusy:value => busy.push(value),
    inspect:payload => { reads.push(copy(payload)); return options.inspect ? options.inspect(payload) : Promise.resolve(copy(catalog)); },
    command:request => { const pending = deferred(); requests.push({request:copy(request), ...pending}); return pending.promise; },
    applied:async (...args) => { applied.push(args); await options.applied?.(...args); },
    openSource:async (...args) => { opened.push(args); return options.openSource ? options.openSource(...args) : true; } });
  controller.setAvailable(options.enabled !== false, options.commands || ['audio.create']);
  const el = suffix => h.element('sceneAudioCreate' + suffix), click = suffix => el(suffix).click();
  const set = (suffix,value,event='input') => { el(suffix).value = value; el(suffix).dispatch(event); };
  const receipt = async request => {
    const result = copy((await fixture.run({...request,mode:'preview'})).result);
    if (request.mode === 'apply') { result.status = 'applied'; result.receipt = {format:'viento-transaction-receipt',schemaVersion:1,transactionId:id(999),worldId:request.worldId,
      proposalId:result.proposal.id,baseRevision:request.baseRevision,revision:result.revision,state:'committed'}; }
    return result;
  };
  const markCreated = async request => {
    const result = await receipt(request), record = result.changes[0].record;
    catalog = {...copy(fixture.context),status:'ready',baseRevision:result.revision,
      scene:{...fixture.context.scene,objectRevision:result.scene.revision},manifest:{objectId:request.objectId,objectRevision:result.object.revision,sourcePath:request.sourcePath,sourceRevision:revision(request.content),
      documentType:request.documentType,parserProfile:record.parserProfile,content:request.content,relations:record.relations,assetBindings:record.assetBindings,trackCount:JSON.parse(request.content.replace(/^\uFEFF/,'')).tracks.length}};
    return result;
  };
  const review = async () => { click('Check'); await settle(); const pending = requests.at(-1); assert.ok(pending,'review command issued'); pending.resolve(await receipt(pending.request)); await settle(); };
  return {...h,el,click,set,controller,context,fixture,requests,reads,applied,opened,busy,receipt,markCreated,review,
    open:async()=>{const opened=controller.open(context.sceneId);await settle();return opened;},getCatalog:()=>copy(catalog),setCatalog:value=>{catalog=copy(value);},uuidCount:()=>uuidCount,
    language:value=>{locale=value;languages.forEach(fn=>fn());}};
}

test('audio creation requires its capability and a clean, visible saved-scene owner', async () => {
  for (const context of [{editable:false},{dirty:true},{creating:true},{busy:true},{visible:false},{session:undefined}]) {
    const h=await harness({context});assert.equal(await h.open(),false);assert.equal(h.reads.length,0);
  }
  const h=await harness({commands:['behavior.create']});assert.equal(await h.open(),false);h.controller.setAvailable(true,['audio.create']);assert.equal(h.controller.open(id(400)),false);assert.equal(await h.open(),true);
  assert.equal(h.el('Dialog').dataset.vientoCloseGuard,'true');assert.equal(h.uuidCount(),3);
});
test('full Rust-validated source and deduplicated asset bindings are reviewed without playing or saving', async () => {
  const h=await harness();await h.open();h.set('Path','documents/audio/first.json');h.set('Role','music','change');h.set('Volume','0.25');h.set('Loop','true','change');h.set('Start','0.125');h.click('AddTrack');h.set('Role','effect','change');h.set('Start','0.5');await h.review();
  const request=h.requests[0].request, source=JSON.parse(request.content);assert.equal(request.command,'audio.create');assert.equal(source.tracks.length,2);assert.equal(source.cues.length,2);assert.ok(source.cues.every(cue=>cue.action==='play'));
  assert.equal(source.tracks[0].volume,.25);assert.equal(source.tracks[0].loop,true);assert.deepEqual(source.cues.map(cue=>cue.atSeconds),[.125,.5]);
  assert.equal(h.el('SourceText').textContent,request.content);assert.equal(h.el('Relations').children.length,3);assert.equal(h.el('Save').disabled,false);assert.equal(h.applied.length,0);assert.equal(h.opened.length,0);
});
test('track selection and three languages preserve raw unfinished fields and stable identities', async () => {
  const h=await harness();await h.open();const first=h.el('TrackList').value;h.set('Volume','-');h.set('Start','1e');h.click('AddTrack');const second=h.el('TrackList').value;h.set('Start','0.5');
  for(const language of ['en','ja','zh-CN']){h.language(language);h.set('TrackList',first,'change');assert.equal(h.el('Volume').value,'-');assert.equal(h.el('Start').value,'1e');h.set('TrackList',second,'change');assert.equal(h.el('Start').value,'0.5');}
  h.click('Check');await settle();assert.equal(h.requests.length,0);assert.equal(h.uuidCount(),5);h.set('TrackList',first,'change');h.set('Volume','0');h.set('Start','0');await h.review();const before=h.requests[0].request;
  h.set('TrackList',second,'change');h.language('en');assert.equal(h.el('Save').disabled,false);assert.equal(h.uuidCount(),5);assert.equal(JSON.parse(before.content).tracks[0].id,first);
});
test('track budget, removal and repeated resources retain all unaffected identities', async () => {
  const h=await harness();await h.open();const first=h.el('TrackList').value;for(let i=0;i<15;i++)h.click('AddTrack');assert.equal(h.el('AddTrack').disabled,true);assert.equal(h.uuidCount(),33);await h.review();
  assert.equal(JSON.parse(h.requests[0].request.content).tracks.length,16);assert.equal(h.el('Relations').children.length,3);
  for(let i=0;i<15;i++)h.click('RemoveTrack');assert.equal(h.el('RemoveTrack').disabled,true);assert.equal(h.el('TrackList').value,first);assert.equal(h.uuidCount(),33);assert.equal(h.el('Save').disabled,true);
});
test('bad number, role, resource, loop and unsafe path inputs cannot issue a transaction', async () => {
  for(const [field,value] of [['Volume',''],['Volume','1.01'],['Volume','NaN'],['Start','60.1'],['Start','-1'],['Role','bus'],['Resource',id(900)],['Loop','yes'],['Path','documents/../bad.json'],['Path','elsewhere/sound.json']]){
    const h=await harness();await h.open();h.set(field,value);h.click('Check');await settle();assert.equal(h.requests.length,0,field+value);
  }
});
test('empty assets explain import and do not invent or verify resources', async () => {
  const h=await harness();const value=h.getCatalog();value.resources=[];h.setCatalog(value);await h.open();assert.equal(h.el('Empty').hidden,false);assert.equal(h.el('Check').disabled,true);assert.equal(h.requests.length,0);
  assert.ok(h.el('Fields').querySelector('[data-i18n="定时音轨创建一条播放提示；行为音轨不创建定时提示。候选素材尚未验证；审阅和保存时会核对真实 PCM16 WAV 与资源摘要。"]'));
});
test('bad catalogs fail closed, including malformed existing audio, without falling back to creation', async () => {
  for(const mutate of [c=>c.schemaVersion++,c=>c.scene.objectId=id(900),c=>c.resources.push(c.resources[0]),c=>c.resources[0].availability='verified',c=>{c.status='ready';c.manifest={};}]){
    const h=await harness();const data=h.getCatalog();mutate(data);h.setCatalog(data);await h.open();assert.equal(h.uuidCount(),0);assert.equal(h.el('Check').disabled,true);assert.equal(h.el('Save').disabled,true);
  }
});
test('late catalogs and previews cannot be accepted by another scene, session or source', async () => {
  for(const change of [h=>h.context.sceneId=id(900),h=>h.context.session='new',h=>h.context.sourceToken='changed',h=>h.context.dirty=true,h=>h.controller.setAvailable(false,[])]){
    const wait=deferred(),h=await harness({inspect:()=>wait.promise});h.controller.open(h.context.sceneId);change(h);wait.resolve(h.fixture.context);await settle();assert.equal(h.uuidCount(),0);
  }
  const h=await harness();await h.open();h.click('Check');await settle();h.context.sourceToken='changed';h.requests[0].resolve(await h.receipt(h.requests[0].request));await settle();assert.equal(h.el('Save').disabled,true);assert.equal(h.applied.length,0);
});
test('silent input changes invalidate a reviewed request before save', async () => {
  const h=await harness();await h.open();await h.review();h.el('Volume').value='0.2';h.click('Save');await settle();assert.equal(h.requests.length,1);assert.equal(h.el('Save').disabled,true);
});
test('apply uses reviewed bytes, confirms real closure after refresh and requires explicit source navigation', async () => {
  let h;h=await harness({applied:async()=>{h.context.sourceToken='own-refresh';}});await h.open();await h.review();const before=h.requests[0].request;h.click('Save');await settle();h.click('Save');h.click('Close');assert.equal(h.el('Dialog').open,true);assert.equal(h.requests.length,2);
  const pending=h.requests[1];assert.deepEqual(pending.request,{...before,mode:'apply'});pending.resolve(await h.markCreated(pending.request));await settle();assert.equal(h.applied.length,1);assert.equal(h.el('Dialog').dataset.dirty,'false');assert.equal(h.opened.length,0);assert.equal(h.el('Open').disabled,false);assert.equal(h.el('Fields').hidden,true);
  h.click('Open');await settle();assert.equal(h.opened[0][0],before.sourcePath);assert.equal(h.opened[0][1].sourceRevision,revision(before.content));assert.equal(h.el('Dialog').open,false);assert.equal(h.requests.length,2);
});
test('forged preview source, identity, asset closure or relationship is never approved', async () => {
  for(const change of [r=>r.changes[0].afterText+=' ',r=>r.changes[0].record.assetBindings=[],r=>r.object.id=id(999),r=>r.changes[1].relation.kind='references']){
    const h=await harness();await h.open();h.click('Check');await settle();const result=await h.receipt(h.requests[0].request);change(result);h.requests[0].resolve(result);await settle();assert.equal(h.el('Save').disabled,true);assert.equal(h.applied.length,0);
  }
});
test('unknown writes never retry, and matching source identity plus complete closure may reconcile read-only', async () => {
  const h=await harness();await h.open();await h.review();h.click('Save');await settle();const request=h.requests[1].request;h.requests[1].reject(Error('connection lost'));await settle();assert.equal(h.el('Dialog').dataset.dirty,'true');h.click('Refresh');await settle();h.click('Save');assert.equal(h.requests.length,2);assert.equal(h.applied.length,0);
  await h.markCreated(request);h.click('Refresh');await settle();assert.equal(h.applied.length,1);assert.equal(h.applied[0][0],null);assert.equal(h.applied[0][1].reconciled,true);assert.equal(h.el('Dialog').dataset.dirty,'false');assert.equal(h.el('Open').disabled,false);assert.equal(h.requests.length,2);
});
test('wrong persisted identity or incomplete closure cannot confirm an uncertain write', async () => {
  for(const change of [c=>c.manifest.objectId=id(990),c=>c.manifest.sourceRevision=revision('different'),c=>c.manifest.assetBindings=[],c=>c.manifest.relations=[]]){
    const h=await harness();await h.open();await h.review();h.click('Save');await settle();const request=h.requests[1].request;h.requests[1].resolve({status:'applied'});await settle();await h.markCreated(request);const next=h.getCatalog();change(next);h.setCatalog(next);h.click('Refresh');await settle();assert.equal(h.applied.length,0);assert.equal(h.el('Open').disabled,true);assert.equal(h.el('Save').disabled,true);assert.equal(h.el('Dialog').dataset.dirty,'true');
  }
});
test('known rejected save preserves stable draft for a new review; host refresh failure cannot repeat a committed save', async () => {
  const h=await harness();await h.open();await h.review();h.click('Save');await settle();h.requests[1].reject(Object.assign(Error('conflict'),{errorCode:'world_revision_conflict'}));await settle();h.click('Refresh');await settle();await h.review();assert.equal(h.requests[2].request.objectId,h.requests[0].request.objectId);
  let reject=true;const other=await harness({applied:async()=>{if(reject)throw Error('refresh failed');}});await other.open();await other.review();other.click('Save');await settle();other.requests[1].resolve(await other.markCreated(other.requests[1].request));await settle();assert.equal(other.el('Open').disabled,true);assert.equal(other.requests.length,2);reject=false;other.click('Refresh');await settle();assert.equal(other.applied.length,2);assert.equal(other.el('Open').disabled,false);assert.equal(other.requests.length,2);
});
test('existing audio only opens after a fresh identity/revision check and never allocates new IDs', async () => {
  const h=await harness();await h.markCreated(h.fixture.request);await h.open();assert.equal(h.uuidCount(),0);assert.equal(h.el('Fields').hidden,true);assert.equal(h.el('Check').hidden,true);assert.equal(h.el('Open').disabled,false);
  const next=h.getCatalog();next.manifest.sourceRevision=revision('changed');h.setCatalog(next);h.click('Open');await settle();assert.equal(h.opened.length,0);assert.match(h.el('Status').textContent,/已变化/);h.click('Open');await settle();assert.equal(h.opened.length,1);assert.equal(h.opened[0][1].sourceRevision,revision('changed'));assert.equal(h.requests.length,0);
});
test('a late apply or source navigation cannot refresh or close a new parent session', async () => {
  const h=await harness();await h.open();await h.review();h.click('Save');await settle();h.context.session='new';h.requests[1].resolve(await h.markCreated(h.requests[1].request));await settle();assert.equal(h.applied.length,0);assert.equal(h.el('Open').disabled,true);
  const wait=deferred();let guard;const n=await harness({openSource:(_p,o)=>{guard=o.isCurrent;return wait.promise;}});await n.markCreated(n.fixture.request);await n.open();n.click('Open');await settle();assert.equal(guard(),true);n.context.session='new';assert.equal(guard(),false);wait.resolve(true);await settle();assert.equal(n.el('Dialog').open,true);
});
test('dirty review and pending operations are exposed to close guards, Escape and cancel preserve user choice', async () => {
  const h=await harness();await h.open();await h.review();assert.equal(h.el('Dialog').dataset.dirty,'true');h.runtime.window.confirm=()=>false;h.click('Cancel');h.el('Dialog').dispatch('cancel');assert.equal(h.el('Dialog').open,true);
  h.click('Save');await settle();h.runtime.window.confirm=()=>true;h.click('Close');assert.equal(h.el('Dialog').open,true);assert.equal(h.el('Dialog').getAttribute('aria-busy'),'true');assert.equal(h.el('Dialog').dispatch('keydown',{key:'s',ctrlKey:true}).defaultPrevented,true);
  h.requests[1].reject(Error('unknown'));await settle();h.click('Cancel');assert.equal(h.el('Dialog').open,false);assert.equal(h.el('Dialog').dataset.dirty,'false');
});
test('dispose releases its busy ownership and prevents late reads from creating state', async () => {
  const wait=deferred(),h=await harness({inspect:()=>wait.promise});h.controller.open(h.context.sceneId);h.controller.dispose();wait.resolve(h.fixture.context);await settle();assert.deepEqual(h.busy,[true,false]);assert.equal(h.uuidCount(),0);assert.equal(h.element('sceneAudioCreateDialog'),null);
});
test('audio-specific visible labels have English and Japanese translations and isolated narrow-screen CSS', async () => {
  const source=await fs.readFile(new URL('../../web/modules/app-scene-audio-create.js',import.meta.url),'utf8');
  const labels=[...source.matchAll(/data-i18n="([^"]+)"/g)].map(match=>match[1]).concat(['定时播放','由行为触发','不创建定时播放提示；需在项目行为中引用音轨身份并发起播放。','按开始时间创建一条播放提示。','全部 {0} 条音轨由行为触发；未创建定时播放提示。','全部 {0} 条音轨定时播放；创建 {1} 条播放提示。','{0} 条音轨定时播放，{1} 条由行为触发；创建 {2} 条定时播放提示。','请选择有效的播放方式。']);for(const key of labels){assert.equal(typeof en[key],'string',key+' en');assert.equal(typeof ja[key],'string',key+' ja');}
  const css=await fs.readFile(new URL('../../web/scene-audio-create.css',import.meta.url),'utf8');assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/overflow:auto/);assert.doesNotMatch(css,/scene-behavior/);
});

test('explicit write-lock and PCM resource rejections preserve draft identities and permit reread then fresh review', async () => {
  for(const errorCode of ['world_write_busy','world_audio_resource_changed','world_audio_resource_format','world_audio_resource_unavailable','world_audio_resource_limit']) {
    const h=await harness();await h.open();await h.review();const reviewed=h.requests[0].request;h.click('Save');await settle();
    h.requests[1].reject(Object.assign(Error('Request explicitly rejected before writing'),{errorCode}));await settle();
    assert.doesNotMatch(h.el('Status').textContent,/尚未确认/,errorCode);assert.equal(h.el('Save').disabled,true);h.click('Refresh');await settle();await h.review();
    assert.equal(h.requests[2].request.objectId,reviewed.objectId);assert.equal(h.requests[2].request.content,reviewed.content);assert.equal(h.applied.length,0);assert.equal(h.el('Save').disabled,false);
  }
});

test('creation defaults to timed playback and keeps the persisted audio schema free of form intent', async () => {
  const h=await harness();await h.open();assert.equal(h.el('StartMode').value,'timeline');assert.equal(h.el('Start').disabled,false);await h.review();
  const source=JSON.parse(h.requests[0].request.content);assert.equal(source.cues.length,1);assert.equal(source.cues[0].atSeconds,0);assert.equal(source.cues[0].action,'play');
  assert.ok(source.tracks.every(track=>!Object.hasOwn(track,'startMode')));assert.match(h.el('PlaybackSummary').textContent,/全部 1 条音轨定时播放/);
});
test('behavior creation ignores unfinished inactive times without losing them or allocating fresh identities', async () => {
  const h=await harness();await h.open();const first=h.el('TrackList').value;h.set('Start','1e');h.set('StartMode','behavior','change');
  assert.equal(h.el('Start').disabled,true);assert.equal(h.el('Start').value,'1e');assert.match(h.el('StartHint').textContent,/需在项目行为中引用音轨身份/);await h.review();
  const request=h.requests[0].request, source=JSON.parse(request.content);assert.equal(source.tracks[0].id,first);assert.deepEqual(source.cues,[]);assert.match(h.el('PlaybackSummary').textContent,/未创建定时播放提示/);
  h.set('StartMode','timeline','change');assert.equal(h.el('Start').value,'1e');assert.equal(h.el('Start').disabled,false);assert.equal(h.el('Save').disabled,true);h.click('Check');await settle();assert.equal(h.requests.length,1);
  h.set('Start','.25');await h.review();const timed=JSON.parse(h.requests[1].request.content);assert.equal(timed.tracks[0].id,first);assert.equal(timed.cues[0].id,id(103));assert.equal(timed.cues[0].atSeconds,.25);assert.equal(h.uuidCount(),3);
  h.set('StartMode','behavior','change');await h.review();assert.equal(h.requests[2].request.content,request.content);assert.equal(h.el('Start').value,'.25');
});
test('mixed creation keeps every track and asset binding but only schedules selected timed tracks', async () => {
  const h=await harness();await h.open();const first=h.el('TrackList').value;h.set('StartMode','behavior','change');h.click('AddTrack');const timedId=h.el('TrackList').value;
  assert.equal(h.el('StartMode').value,'timeline');h.set('Start','.375');h.click('AddTrack');const third=h.el('TrackList').value;h.set('StartMode','behavior','change');await h.review();
  const source=JSON.parse(h.requests[0].request.content);assert.deepEqual(source.tracks.map(track=>track.id),[first,timedId,third]);assert.deepEqual(source.cues.map(cue=>[cue.trackId,cue.atSeconds]),[[timedId,.375]]);
  assert.equal(h.el('Relations').children.length,3);assert.match(h.el('PlaybackSummary').textContent,/1 条音轨定时播放，2 条由行为触发/);
  h.set('TrackList',timedId,'change');h.set('StartMode','behavior','change');await h.review();assert.equal(JSON.parse(h.requests[1].request.content).tracks.length,3);assert.deepEqual(JSON.parse(h.requests[1].request.content).cues,[]);
  assert.match(h.el('PlaybackSummary').textContent,/全部 3 条音轨由行为触发/);assert.equal(h.uuidCount(),7);
});
test('trigger, selected resource, raw inputs and stable tracks survive three-language changes', async () => {
  const h=await harness();const catalog=h.getCatalog(), extra={...catalog.resources[0],resourceId:id(901),name:'Second tone',sourcePath:'second.wav'};catalog.resources.push(extra);h.setCatalog(catalog);await h.open();
  const first=h.el('TrackList').value;h.set('Resource',extra.resourceId,'change');h.set('Start','1e');h.set('Volume','-');h.set('StartMode','behavior','change');h.click('AddTrack');const second=h.el('TrackList').value;h.set('Resource',catalog.resources[0].resourceId,'change');h.set('Start','.5');
  for(const language of ['en','ja','zh-CN']) {
    h.language(language);h.set('TrackList',first,'change');assert.equal(h.el('Resource').value,extra.resourceId);assert.equal(h.el('StartMode').value,'behavior');assert.equal(h.el('Start').value,'1e');assert.equal(h.el('Start').disabled,true);assert.equal(h.el('Volume').value,'-');
    h.set('TrackList',second,'change');assert.equal(h.el('Resource').value,catalog.resources[0].resourceId);assert.equal(h.el('StartMode').value,'timeline');assert.equal(h.el('Start').value,'.5');assert.equal(h.el('Start').disabled,false);
  }
  assert.equal(h.uuidCount(),5);assert.equal(h.requests.length,0);
});
test('approved behavior and mixed summaries translate without invalidating the reviewed source', async () => {
  const h=await harness();await h.open();h.set('StartMode','behavior','change');await h.review();const content=h.requests[0].request.content;
  for(const [language,phrase] of [['en',/no timed play cues/],['ja',/時刻指定の再生キューは作成しません/],['zh-CN',/未创建定时播放提示/]]) {
    h.language(language);assert.equal(h.el('Save').disabled,false);assert.equal(h.el('SourceText').textContent,content);assert.match(h.el('PlaybackSummary').textContent,phrase);assert.equal(h.el('StartMode').value,'behavior');
  }
  h.click('AddTrack');await h.review();h.language('en');assert.match(h.el('PlaybackSummary').textContent,/1 tracks use timed playback and 1 are triggered by behavior/);h.language('ja');assert.match(h.el('PlaybackSummary').textContent,/トラックが 1/);
});
test('invalid and silently changed trigger modes cannot save a different approved intent', async () => {
  const h=await harness();await h.open();h.set('StartMode','automatic','change');h.click('Check');await settle();assert.equal(h.requests.length,0);assert.match(h.el('Status').textContent,/请选择有效的播放方式/);
  h.set('StartMode','behavior','change');await h.review();h.el('StartMode').value='timeline';h.click('Save');await settle();assert.equal(h.requests.length,1);assert.equal(h.el('Save').disabled,true);assert.equal(h.el('Review').hidden,true);
});
test('behavior mode still respects cancellation, stale source and explicitly rejected save ownership', async () => {
  const h=await harness();await h.open();h.set('StartMode','behavior','change');h.runtime.window.confirm=()=>false;h.click('Cancel');assert.equal(h.el('Dialog').open,true);assert.equal(h.el('StartMode').value,'behavior');
  h.click('Check');await settle();h.context.sourceToken='changed';h.requests[0].resolve(await h.receipt(h.requests[0].request));await settle();assert.equal(h.el('Save').disabled,true);assert.equal(h.el('Review').hidden,true);assert.equal(h.applied.length,0);
  h.runtime.window.confirm=()=>true;h.click('Cancel');assert.equal(h.el('Dialog').open,false);await h.open();assert.equal(h.el('StartMode').value,'timeline');h.set('StartMode','behavior','change');await h.review();const reviewed=h.requests.at(-1).request;
  h.click('Save');await settle();h.requests.at(-1).reject(Object.assign(Error('conflict'),{errorCode:'world_revision_conflict'}));await settle();h.click('Refresh');await settle();assert.equal(h.el('StartMode').value,'behavior');await h.review();assert.equal(h.requests.at(-1).request.content,reviewed.content);assert.equal(h.requests.at(-1).request.objectId,reviewed.objectId);
});
test('all-behavior save uses the exact reviewed empty-cue document and can open the saved source', async () => {
  const h=await harness();await h.open();h.set('StartMode','behavior','change');await h.review();const before=h.requests[0].request;h.click('Save');await settle();assert.deepEqual(h.requests[1].request,{...before,mode:'apply'});
  h.requests[1].resolve(await h.markCreated(h.requests[1].request));await settle();assert.equal(h.applied.length,1);assert.equal(h.el('Fields').hidden,true);assert.equal(h.el('Open').disabled,false);assert.deepEqual(JSON.parse(h.getCatalog().manifest.content).cues,[]);h.click('Open');await settle();assert.equal(h.opened[0][0],before.sourcePath);assert.equal(h.el('Dialog').open,false);
});
