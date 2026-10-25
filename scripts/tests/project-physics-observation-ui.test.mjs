import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { validateProjectPhysics2DObservation } from '../../engine/project-physics2d-trace.mjs';
import { observationId as id, physicsObservationSample as sample, physicsObservationSnapshot as snapshot, physicsObservationSource as source } from './helpers/project-physics2d-observation-fixture.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
async function fixture(t, options = {}) {
  let dictionary = {}, languageChanged = () => {}, subscriptions = 0;
  const calls = [], context = { available: true, visible: true, sessionOwner: 'job:build:snapshot:assembly', navigationOwner: 'dialog:1', canOpenSource: true, canContinueSource: true };
  const h = await dialogHarness('app-project-physics-observation', { validateProjectPhysics2DObservation,
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    onLanguageChange(callback) { languageChanged = callback; subscriptions++; return () => { languageChanged = () => {}; subscriptions--; }; } });
  const container = h.document.createElement('div'); container.isConnected = true; h.document.body.append(container);
  const observer = h.runtime.setupProjectPhysicsObservation({ container, getContext: () => context,
    onOpen: async (source, opts) => { calls.push({ source, ...opts }); return options.onOpen ? options.onOpen(source, opts) : true; } });
  t.after(() => observer.dispose());
  const el = suffix => h.element('projectPhysicsObservation' + suffix);
  return { ...h, container, observer, context, calls, el, set: value => observer.setSnapshot(value),
    change(suffix, value) { el(suffix).value = value; el(suffix).dispatch('change'); },
    language(value) { dictionary = value; languageChanged(); }, subscriptions: () => subscriptions };
}
const colliderButton = h => h.el('Contacts').querySelector('.project-physics-collider-source');

test('physics observations distinguish missing, waiting, finished-empty and interrupted data without a contact-state claim', async t => {
  const h = await fixture(t); h.set(null); assert.equal(h.el('Panel').hidden, true);
  for (const phase of ['waiting', 'recording', 'finished', 'incomplete']) {
    h.set(snapshot({ phase, samples: [] })); assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Status').dataset.phase, phase);
    assert.equal(h.el('Detail').hidden, true); assert.match(h.el('Empty').textContent, /不表示场景没有碰撞/);
  }
  assert.match(h.el('Status').textContent, /记录未完成/); assert.match(h.el('Note').textContent, /不是持续接触、传感器或着地状态/);
});

test('selected sample displays exact request, displacement, positions and native sweep vectors without simulation', async t => {
  const h = await fixture(t), value = snapshot(); h.set(value);
  assert.equal(h.el('Detail').dataset.sequence, '1'); assert.match(h.el('Motion').textContent, /请求位移\[6, 4\].*实际位移\[2, 4\].*移动前位置\[10, 20\].*移动后位置\[12, 24\]/);
  assert.match(h.el('Contacts').textContent, /接触位置（场景坐标）\[15, 20\].*法线\[-1, 0\].*扫描已走位移\[2, 1\].*扫描剩余位移\[4, 3\]/);
  assert.match(h.el('Identity').textContent, new RegExp(id(20))); assert.match(h.el('Identity').textContent, new RegExp(id(10)));
  assert.equal(h.container.querySelector('img'), null); assert.equal(h.calls.length, 0); assert.deepEqual(value, snapshot());
});

test('unknown colliders have no source action and empty collision lists never imply persistent separation', async t => {
  const h = await fixture(t), value = snapshot(); value.samples[0].contacts[0].collider = null; h.set(value);
  assert.match(h.el('Contacts').textContent, /未映射碰撞体/); assert.equal(colliderButton(h).hidden, true); colliderButton(h).dispatch('click'); assert.equal(h.calls.length, 0);
  value.samples[0].contacts = []; h.set(value); assert.equal(h.el('Contacts').children.length, 0); assert.equal(h.el('NoContacts').hidden, false); assert.match(h.el('NoContacts').textContent, /不表示持续无接触/);
});

test('instance, visit-step and sample selection preserve distinct repeated steps and offer bounded previous/next navigation', async t => {
  const h = await fixture(t), samples = [sample(1), sample(2,{instance:1}), sample(3,{step:2}), sample(4,{step:2,instance:1}), sample(5,{visit:2})]; h.set(snapshot({ samples }));
  h.change('Instance', id(21)); assert.equal(h.el('Sample').children.length, 2); assert.equal(h.el('Detail').dataset.sequence, '2');
  h.el('Next').click(); assert.equal(h.el('Detail').dataset.sequence, '4'); assert.equal(h.el('Next').disabled, true); h.el('Next').dispatch('click'); assert.equal(h.el('Detail').dataset.sequence, '4');
  h.el('Previous').click(); assert.equal(h.el('Detail').dataset.sequence, '2');
  h.change('Step', `1:${id(2)}:2`); assert.equal(h.el('Sample').children.length, 1); assert.equal(h.el('Detail').dataset.sequence, '4');
  h.change('Instance', ''); h.change('Step', `2:${id(3)}:1`); assert.equal(h.el('Detail').dataset.sequence, '5');
  h.change('Step', ''); h.change('Sample', '3'); assert.equal(h.el('Detail').dataset.sequence, '3');
});

test('compact numeric values retain complete native precision in accessible titles', async t => {
  const h=await fixture(t), value=snapshot();value.samples[0].requestedMotion[0]=1/60;h.set(value);
  const output=h.el('Motion').querySelectorAll('dd')[3];assert.equal(output.textContent,'[0.016666667, 4]');assert.equal(output.title,'[0.016666666666666666, 4]');
});

test('source buttons preserve separate physics declarations and exact source ranges', async t => {
  const h = await fixture(t); h.set(snapshot()); h.el('Open').click(); await flushDialogs(); colliderButton(h).click(); await flushDialogs();
  assert.deepEqual(h.calls.map(call => call.source), [source(0), source(2)]); assert.notEqual(h.calls[0].source.objectId, snapshot().samples[0].objectId);
});

test('appended samples and languages preserve filters, selected control focus and admitted source navigation', async t => {
  const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(snapshot({phase:'recording'})); h.change('Instance',id(20));
  const select = h.el('Sample'), button = colliderButton(h); select.focus(); button.click(); assert.equal(h.calls[0].isCurrent(),true);
  h.set(snapshot({samples:[sample(1),sample(2,{step:2})]}));
  for (const dictionary of [en,ja,{}]) { h.language(dictionary); assert.equal(h.el('Sample'),select); assert.equal(h.document.activeElement,select); assert.equal(h.el('Instance').value,id(20)); assert.equal(h.el('Sample').value,'1'); assert.equal(colliderButton(h),button); assert.equal(h.calls[0].isCurrent(),true); }
  gate.resolve(true); await flushDialogs(); assert.equal(h.el('Navigation').hidden,true);
});

test('selection, owner, visibility, capability and late dirty changes revoke pending source reads', async t => {
  for (const change of ['selection','session','navigation','hidden','unavailable','dirty','detach','remove','replace']) {
    const gate=deferred(), h=await fixture(t,{onOpen:()=>gate.promise}); h.set(snapshot({samples:[sample(1),sample(2,{step:2})]})); const old=colliderButton(h); old.click();
    if(change==='selection')h.change('Sample','2'); else if(change==='session')h.context.sessionOwner='other-job'; else if(change==='navigation')h.context.navigationOwner='other-dialog';
    else if(change==='hidden')h.context.visible=false; else if(change==='unavailable')h.context.available=false; else if(change==='dirty')h.context.canContinueSource=false;
    else if(change==='detach')h.container.isConnected=false; else if(change==='remove')h.set(null); else {const value=snapshot();value.samples[0].source.sourceRevision='sha256:'+'b'.repeat(64);h.set(value);}
    h.observer.refresh(); assert.equal(h.calls[0].isCurrent(),false,change); gate.resolve(false); await flushDialogs(); assert.equal(h.el('Navigation').hidden,true,change);
  }
});

test('capability and session ABA cannot revive a pending navigation ticket', async t => {
  for (const field of ['available','sessionOwner','navigationOwner']) {
    const gate=deferred(),h=await fixture(t,{onOpen:()=>gate.promise});h.set(snapshot());h.el('Open').click(); const before=h.context[field]; h.context[field]=field==='available'?false:'other';h.observer.refresh();h.context[field]=before;h.set(snapshot());h.observer.refresh();
    assert.equal(h.calls[0].isCurrent(),false);gate.resolve(true);await flushDialogs();
  }
});

test('busy click admission is separate from an already admitted read and duplicate navigation remains single-flight', async t => {
  const gate=deferred(),h=await fixture(t,{onOpen:()=>gate.promise});h.set(snapshot());h.context.canOpenSource=false;h.el('Open').dispatch('click');assert.equal(h.calls.length,0);
  h.context.canOpenSource=true;h.el('Open').click();h.context.canOpenSource=false;h.observer.refresh();assert.equal(h.calls[0].isCurrent(),true);colliderButton(h).dispatch('click');assert.equal(h.calls.length,1);
  gate.resolve(false);await flushDialogs();assert.match(h.el('Navigation').textContent,/无法打开物理来源/);assert.equal(h.el('Detail').hidden,false);
});

test('validated snapshots detach caller mutations and reject unknown fields, getters, sparse arrays and mismatched displacement', async t => {
  const h=await fixture(t), value=snapshot();h.set(value);value.samples[0].source.sourcePath='redirect.json';h.el('Open').click();await flushDialogs();assert.equal(h.calls[0].source.sourcePath,source().sourcePath);
  let invoked=0;
  for(const mutate of [v=>v.grounded=true,v=>v.samples[0].displacement[0]=9,v=>v.samples[0].contacts[0].normal=[0,0],v=>delete v.samples[0].positionBefore[0],v=>v.samples[0].source.propertyPath='/actors/0',v=>v.samples.push({...v.samples[0]}),v=>Object.defineProperty(v.samples[0],'response',{enumerable:true,get(){invoked++;return 'slide';}}),v=>v.toJSON=()=>{invoked++;return snapshot();}]) {
    h.set(snapshot());const bad=snapshot();mutate(bad);h.set(bad);assert.equal(h.el('Panel').hidden,true);assert.equal(h.el('Detail').hidden,true);
  }
  assert.equal(invoked,0);
});

test('256 samples show an explicit partial-record limit without rendering an unbounded contact list', async t => {
  const h=await fixture(t),samples=Array.from({length:256},(_,i)=>sample(i+1,{instance:i%9,step:Math.floor(i/9)+1}));h.set(snapshot({samples,limited:true}));
  assert.equal(h.el('Panel').hidden,false);assert.equal(h.el('Sample').children.length,256);assert.match(h.el('Status').textContent,/部分记录.*256.*后续移动未记录/);assert.equal(h.el('Contacts').children.length,1);
  h.change('Sample','256');assert.equal(h.el('Detail').dataset.sequence,'256');h.set(snapshot({phase:'incomplete',samples,limited:true}));assert.equal(h.el('Status').dataset.phase,'incomplete');assert.match(h.el('Status').textContent,/部分记录/);assert.match(h.el('Status').textContent,/记录未完成/);
});

test('new jobs reset selections while disposal revokes controls and unsubscribes translations', async t => {
  const h=await fixture(t);h.set(snapshot());h.change('Instance',id(20));h.context.sessionOwner='next-job';h.set(snapshot());assert.equal(h.el('Instance').value,'');
  const old=h.el('Open');h.observer.dispose();old.dispatch('click');assert.equal(h.calls.length,0);assert.equal(h.subscriptions(),0);assert.equal(h.container.children.length,0);
});

test('observation module stays read-only, translated and responsive with one stylesheet entry', async () => {
  const source=await fs.readFile(new URL('../../web/modules/app-project-physics-observation.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/fetch\(|fetchJsonApiRequest|requestWorldCommand|requestAnimationFrame|setInterval|setTimeout|position\s*=/);
  for(const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)){assert.ok(en[match[1]],'English: '+match[1]);assert.ok(ja[match[1]],'Japanese: '+match[1]);}
  const css=await fs.readFile(new URL('../../web/project-physics-observation.css',import.meta.url),'utf8');assert.match(css,/@media \(max-width: 600px\)/);assert.match(css,/overflow-wrap: anywhere/);
  const html=await fs.readFile(new URL('../../web/index.html',import.meta.url),'utf8');assert.equal(html.match(/href="\/web\/project-physics-observation.css"/g)?.length,1);
});
