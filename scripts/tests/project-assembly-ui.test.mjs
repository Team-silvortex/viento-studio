import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { inspectProjectAssembly, validateProjectAssembly } from '../../engine/project-assembly.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id = n => `${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`, sha = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
async function settle() { for(let i=0;i<3;i++){await flushDialogs();await new Promise(resolve=>setTimeout(resolve,2));} }
async function harness(options={}) {
 const context={editable:true,dirty:false,creating:false,busy:false,visible:true,session:'one',sourceToken:'one',sceneId:id(1),...options.context},calls=[],applied=[],busy=[],languages=[];let catalog={worldId:'world:'+'a'.repeat(64),baseRevision:sha('base'),scenes:[1,2].map(n=>({id:id(n),title:'Scene '+n,path:`documents/scenes/${n}.json`,version:sha('scene'+n)})),documents:[],defaults:{documentsPath:'documents',documentType:'document',documentTypes:[{id:'document',label:'文档'}]}},documents=new Map(),saveGate=null;
 const h=await dialogHarness('app-project-assembly',{crypto:webcrypto,inspectProjectAssembly,validateProjectAssembly:value=>validateProjectAssembly(copy(value)),getCreatePathError,onLanguageChange:fn=>languages.push(fn)});
 if(options.t)h.runtime.t=options.t;
 const persist=(payload)=>{const documentId=payload.documentId||id(90),value=JSON.parse(payload.content.replace(/^\uFEFF/,'')),row={worldId:catalog.worldId,baseRevision:sha('next'),id:documentId,path:payload.sourcePath||documents.get(documentId)?.path,documentType:payload.documentType||'document',title:value.title,version:sha(payload.content),valid:true,diagnostics:[],content:payload.content,definition:value};documents.set(documentId,row);catalog.baseRevision=row.baseRevision;catalog.documents=[copy(row)];return copy(row);};
 const controller=h.runtime.setupProjectAssembly({getContext:()=>context,setBusy:value=>busy.push(value),request:async payload=>{calls.push(copy(payload));if(options.request)return options.request(payload);if(payload.action==='assembly-list')return copy(catalog);if(payload.action==='assembly-load')return copy(documents.get(payload.documentId));saveGate=deferred();return saveGate.promise;},applied:async value=>{applied.push(copy(value));await options.applied?.(value);}});
 controller.setAvailable(true);const el=name=>h.element('projectAssembly'+name),click=name=>el(name).click(),set=(name,value,event='input')=>{el(name).value=value;el(name).dispatch(event);};
 return{...h,controller,context,el,click,set,calls,applied,busy,persist,gate:()=>saveGate,open:async id=>{await controller.open(id);await settle();},catalog:()=>catalog,documents,languages,add:n=>{set('Candidate',id(n),'change');click('Add');},review:()=>click('Check')};
}
test('assembly author owns an independent guarded dialog and clean visible author session',async()=>{for(const context of [{editable:false},{dirty:true},{creating:true},{busy:true},{visible:false}]){const h=await harness({context});assert.equal(await h.controller.open(),false);assert.equal(h.calls.length,0);}const h=await harness();await h.open();assert.equal(h.el('Dialog').dataset.vientoCloseGuard,'true');assert.equal(h.document.querySelector('link[data-project-assembly]').href,'/web/project-assembly.css');assert.equal(h.el('Save').disabled,true);assert.equal(h.calls[0].action,'assembly-list');});
test('ordered members and entry selection generate a complete reviewed JSON without executing a build',async()=>{const h=await harness();await h.open();h.set('Name','Journey');h.add(1);h.add(2);h.click('Up');h.set('Entry',id(1),'change');h.review();const value=JSON.parse(h.el('Source').textContent);assert.deepEqual(value.sceneIds,[id(2),id(1)]);assert.equal(value.entrySceneId,id(1));assert.equal(value.title,'Journey');assert.equal(h.calls.length,1);assert.equal(h.el('Save').disabled,false);h.click('Remove');assert.equal(h.el('Save').disabled,true);assert.equal(h.el('Members').children.length,1);});
test('a review is invalidated by visible or silent field changes and incomplete membership cannot save',async()=>{const h=await harness();await h.open();h.review();assert.equal(h.el('Save').disabled,true);h.add(1);h.review();h.el('Name').value='silent';h.click('Save');await settle();assert.equal(h.calls.length,1);assert.equal(h.el('Save').disabled,true);h.set('Path','documents/../bad.json');h.review();assert.equal(h.el('Save').disabled,true);});
test('save submits only reviewed source, uses returned stable identity for edits, and does not retry during publication',async()=>{const h=await harness();await h.open();h.add(1);h.review();const source=h.el('Source').textContent;h.click('Save');await settle();h.click('Save');h.click('Close');assert.equal(h.el('Dialog').open,true);const request=h.calls.at(-1);assert.equal(request.content,source);h.gate().resolve(h.persist(request));await settle();assert.equal(h.applied.length,1);assert.equal(h.el('Dialog').dataset.dirty,'false');assert.equal(h.el('Path').disabled,true);h.set('Name','Update');h.review();h.click('Save');await settle();assert.equal(h.calls.at(-1).documentId,id(90));assert.equal(h.calls.at(-1).expectedVersion,sha(source));assert.equal(Object.hasOwn(h.calls.at(-1),'sourcePath'),false);h.gate().resolve(h.persist(h.calls.at(-1)));await settle();});
test('uncertain save never retries and converges only after matching source identity, exact bytes and hash',async()=>{const h=await harness();await h.open();h.add(1);h.review();h.click('Save');await settle();const request=h.calls.at(-1);h.persist(request);h.gate().reject(Error('response lost'));await settle();assert.equal(h.el('Save').disabled,true);h.click('Save');assert.equal(h.calls.filter(x=>x.action==='assembly-save').length,1);h.click('Refresh');await settle();assert.equal(h.applied.length,1);assert.equal(h.el('Dialog').dataset.dirty,'false');const other=await harness();await other.open();other.add(1);other.review();other.click('Save');await settle();other.gate().resolve({});await settle();other.click('Refresh');await settle();assert.equal(other.applied.length,0);assert.equal(other.el('Save').disabled,true);assert.equal(other.el('Dialog').dataset.dirty,'true');});
test('known conflict preserves title and members and requires a new read/review',async()=>{const h=await harness();await h.open();h.add(2);h.set('Name','Keep draft');h.review();h.click('Save');await settle();h.gate().reject(Object.assign(Error('conflict'),{errorCode:'project_assembly_document_conflict'}));await settle();assert.equal(h.el('Name').value,'Keep draft');assert.equal(h.el('Save').disabled,true);h.click('Refresh');await settle();h.review();assert.equal(h.el('Save').disabled,false);assert.deepEqual(JSON.parse(h.el('Source').textContent).sceneIds,[id(2)]);});
test('late save and catalog replies cannot take over another author session',async()=>{const wait=deferred(),h=await harness({request:()=>wait.promise});const pending=h.controller.open();h.context.session='next';wait.resolve(h.catalog());await pending;assert.equal(h.el('Check').disabled,true);const other=await harness();await other.open();other.add(1);other.review();other.click('Save');await settle();other.context.sourceToken='next';other.gate().resolve(other.persist(other.calls.at(-1)));await settle();assert.equal(other.applied.length,0);assert.equal(other.el('Save').disabled,true);});
test('load preserves the original source until changes, and cancel keeps a rejected dirty draft open',async()=>{const h=await harness();const raw='\uFEFF'+JSON.stringify({format:'viento-project-assembly',schemaVersion:1,title:'Original',sceneIds:[id(1)],entrySceneId:id(1)},null,4)+'\r\n';h.persist({sourcePath:'documents/projects/original.json',documentType:'document',content:raw});await h.open(id(90));h.review();assert.equal(h.el('Source').textContent,raw);h.set('Name','Changed');h.runtime.window.confirm=()=>false;h.click('Cancel');assert.equal(h.el('Dialog').open,true);h.runtime.window.confirm=()=>true;h.click('Cancel');assert.equal(h.el('Dialog').open,false);});
test('all assembly labels translate and narrow-screen rules preserve visible footer actions',async()=>{const source=await fs.readFile(new URL('../../web/modules/app-project-assembly.js',import.meta.url),'utf8');for(const match of source.matchAll(/data-i18n="([^"]+)"/g)){assert.equal(typeof en[match[1]],'string',match[1]+' en');assert.equal(typeof ja[match[1]],'string',match[1]+' ja');}const css=await fs.readFile(new URL('../../web/project-assembly.css',import.meta.url),'utf8');assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/overflow:auto/);assert.doesNotMatch(source,/play\(|runProject|setupScene/);});

test('unknown create result cannot converge through a different registered document type',async()=>{const h=await harness();await h.open();h.add(1);h.review();h.click('Save');await settle();const request=h.calls.at(-1),saved=h.persist(request);h.documents.get(saved.id).documentType='other';h.gate().reject(Error('lost'));await settle();h.click('Refresh');await settle();assert.equal(h.applied.length,0);assert.equal(h.el('Dialog').dataset.dirty,'true');assert.equal(h.el('Save').disabled,true);});


test('opening for a saved scene seeds one reviewed entry without automatically saving or building', async () => {
 let h; h = await harness({ context: { sceneId: id(2) }, applied: async () => { h.context.sceneId = ''; h.context.sourceToken = 'saved'; } });
 assert.equal(await h.controller.openForScene(id(2)), true);
 assert.equal(h.el('Name').value, 'Scene 2 的项目组装');
 assert.equal(h.el('Path').value, `documents/projects/assembly-${id(2)}.json`);
 assert.equal(h.el('Members').children.length, 1); assert.equal(h.el('Members').value, id(2)); assert.equal(h.el('Entry').value, id(2));
 assert.equal(h.el('Dialog').dataset.dirty, 'true'); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('Save').disabled, true);
 assert.deepEqual(h.calls, [{ action: 'assembly-list' }]);
 h.review(); const definition = JSON.parse(h.el('Source').textContent);
 assert.deepEqual(definition.sceneIds, [id(2)]); assert.equal(definition.entrySceneId, id(2)); assert.equal(h.el('Save').disabled, false);
 h.click('Save'); await settle(); const payload = h.calls.at(-1);
 assert.equal(payload.action, 'assembly-save'); assert.equal(payload.sourcePath, `documents/projects/assembly-${id(2)}.json`); assert.equal(payload.baseRevision, sha('base'));
 h.gate().resolve(h.persist(payload)); await settle();
 assert.equal(h.applied.length, 1); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Check').disabled, false);
});

test('scene entry rejects invalid identity, unready authors and reopening an existing dirty draft', async () => {
 for (const context of [{ sceneId: id(2) }, { editable: false }, { dirty: true }, { creating: true }, { busy: true }, { visible: false }]) {
  const h = await harness({ context }); assert.equal(await h.controller.openForScene(id(1)), false); assert.equal(h.calls.length, 0); assert.equal(h.el('Dialog').open, false);
 }
 const h = await harness(); assert.equal(await h.controller.openForScene('../scene'), false); assert.equal(h.calls.length, 0);
 await h.open(); h.set('Name', 'Keep manual draft'); h.add(2);
 assert.equal(await h.controller.openForScene(id(1)), false); assert.equal(h.el('Name').value, 'Keep manual draft'); assert.equal(h.el('Members').value, id(2));
 const other = await harness(); await other.open(''); assert.equal(other.el('Name').value, '新项目组装'); assert.equal(other.el('Members').children.length, 0); assert.equal(other.el('Entry').value, ''); assert.equal(other.el('Dialog').dataset.dirty, 'false');
});

test('seeded draft chooses an unused known assembly path and bounds Unicode scene titles', async () => {
 const h = await harness(); const base = `documents/projects/assembly-${id(1)}`;
 h.catalog().documents = [base + '.json', base + '-2.json'].map((path, index) => ({ id: id(30 + index), version: sha(path), path, title: 'Existing', valid: true }));
 h.catalog().scenes[0].title = 'x'.repeat(159) + '😀';
 assert.equal(await h.controller.openForScene(id(1)), true); assert.equal(h.el('Path').value, base + '-3.json');
 assert.ok(h.el('Name').value.length <= 160); assert.doesNotMatch(h.el('Name').value, /[\uD800-\uDBFF]$/);
 h.review(); assert.equal(h.el('Save').disabled, false); assert.equal(h.calls.length, 1);
});

test('missing or malformed saved scene catalog never silently creates an empty scene draft', async () => {
 const h = await harness(); h.catalog().scenes = [h.catalog().scenes[1]];
 assert.equal(await h.controller.openForScene(id(1)), false); assert.equal(h.el('Name').value, ''); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Save').disabled, true);
 assert.equal(h.el('Error').textContent, '当前场景不在已保存的二维场景目录中，请先保存场景后重新打开组装。');
 h.click('Refresh'); await settle(); assert.equal(h.el('Name').value, ''); assert.equal(h.el('Check').disabled, true);
 h.click('New'); assert.equal(h.el('Name').value, '新项目组装'); assert.equal(h.el('Members').children.length, 0);
 for (const bad of [{ invalid: true }, null]) {
  const other = await harness({ request: async () => bad }); assert.equal(await other.controller.openForScene(id(1)), false);
  assert.equal(other.el('Name').value, ''); assert.equal(other.el('Check').disabled, true); assert.equal(other.el('Error').hidden, false);
 }
 const unavailable = await harness({ request: async () => { throw Error('offline'); } });
 assert.equal(await unavailable.controller.openForScene(id(1)), false); assert.equal(unavailable.el('Name').value, ''); assert.equal(unavailable.el('Save').disabled, true);
});

test('late catalog cannot seed another scene, changed source, closed session or unready author', async () => {
 for (const change of [{ sceneId: id(2) }, { sourceToken: 'next' }, { session: 'next' }, { visible: false }, { editable: false }, { dirty: true }, { creating: true }, { busy: true }]) {
  const gate = deferred(), h = await harness({ request: () => gate.promise }); const pending = h.controller.openForScene(id(1));
  Object.assign(h.context, change); h.controller.refresh(); gate.resolve(h.catalog());
  assert.equal(await pending, false); assert.equal(h.el('Name').value, '', JSON.stringify(change)); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Save').disabled, true); assert.equal(h.calls.length, 1);
 }
 const gate = deferred(), h = await harness({ request: () => gate.promise }); const pending = h.controller.openForScene(id(1)); h.controller.dispose(); gate.resolve(h.catalog()); assert.equal(await pending, false); assert.equal(h.applied.length, 0);
});

test('scene ownership survives review and rejects changed selection or source before save', async () => {
 for (const change of [{ sceneId: id(2) }, { sourceToken: 'changed' }, { dirty: true }, { creating: true }, { busy: true }]) {
  const h = await harness(); await h.controller.openForScene(id(1)); h.review(); Object.assign(h.context, change);
  h.click('Save'); await settle(); assert.equal(h.calls.length, 1); assert.equal(h.applied.length, 0); h.controller.refresh(); assert.equal(h.el('Save').disabled, true);
 }
});

test('seeded close confirms unsaved intent and a fresh reopen seeds only the newly selected scene', async () => {
 const h = await harness(); const opener = h.document.createElement('button'); h.document.body.append(opener); opener.focus(); await h.controller.openForScene(id(1));
 let confirmations = 0; h.runtime.window.confirm = () => { confirmations++; return false; }; h.click('Close'); assert.equal(confirmations, 1); assert.equal(h.el('Dialog').open, true);
 h.runtime.window.confirm = () => true; h.click('Cancel'); assert.equal(h.el('Dialog').open, false); assert.equal(h.document.activeElement, opener);
 h.context.sceneId = id(2); assert.equal(await h.controller.openForScene(id(2)), true); assert.equal(h.el('Members').children.length, 1); assert.equal(h.el('Members').value, id(2)); assert.equal(h.el('Entry').value, id(2)); assert.equal(h.calls.length, 2);
});

test('scene draft copies saved metadata and language refresh preserves authored fields and selection', async () => {
 let language = 'zh'; const dictionaries = { zh: {}, en, ja }, translate = (key, ...values) => (dictionaries[language][key] || key).replace(/\{(\d+)\}/g, (_, index) => String(values[index] ?? ''));
 const h = await harness({ t: translate }); await h.controller.openForScene(id(1));
 h.set('Name', 'My title'); h.set('Path', 'documents/projects/custom.json'); h.add(2); h.set('Entry', id(2), 'change');
 for (const next of ['en', 'ja', 'zh']) {
  language = next; for (const render of h.languages) render();
  assert.equal(h.el('Name').value, 'My title'); assert.equal(h.el('Path').value, 'documents/projects/custom.json'); assert.equal(h.el('Entry').value, id(2)); assert.equal(h.el('Members').value, id(2));
  assert.equal(h.el('Status').textContent, translate('已将当前场景设为首个成员和启动场景，请审阅后保存组装。'));
 }
 for (const key of ['{0} 的项目组装', '已将当前场景设为首个成员和启动场景，请审阅后保存组装。', '当前场景不在已保存的二维场景目录中，请先保存场景后重新打开组装。', '当前作者状态已变化，请返回后重新打开组装。']) {
  assert.equal(typeof en[key], 'string', key + ' en'); assert.equal(typeof ja[key], 'string', key + ' ja');
 }
 h.catalog().scenes[0].title = 'External mutation'; h.review(); assert.equal(JSON.parse(h.el('Source').textContent).title, 'My title'); assert.match(h.el('Members').children[0].textContent, /Scene 1/);
});

test('confirmed new and updated assembly remains selected with its current title before a catalog refresh', async()=>{
 for(const seeded of [false,true]){
  const h=await harness();if(seeded) await h.controller.openForScene(id(1));else{await h.open();h.add(1);}
  h.set('Name','Created assembly');h.review();h.click('Save');await settle();h.gate().resolve(h.persist(h.calls.at(-1)));await settle();
  let option=h.el('Documents').children.find(item=>item.value===id(90));assert.ok(option);assert.equal(option.textContent,'Created assembly');assert.equal(h.el('Documents').value,id(90));
  h.set('Name','Updated assembly');h.review();h.click('Save');await settle();h.gate().resolve(h.persist(h.calls.at(-1)));await settle();
  option=h.el('Documents').children.find(item=>item.value===id(90));assert.equal(option.textContent,'Updated assembly');assert.equal(h.el('Documents').value,id(90));
  assert.equal(h.calls.filter(row=>row.action==='assembly-list').length,1);
 }
});
