import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { inspectSceneHUD2DDocument } from '../../engine/scene-hud2d.mjs';
import { resolveSceneHUD2DView } from '../../engine/scene-hud2d-view.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
const id = n => `73737373-7373-4737-8737-${String(n).padStart(12, '0')}`;
const hash = 'sha256:' + 'a'.repeat(64), world = 'world:' + 'b'.repeat(64);
const initial = { format:'viento-scene-hud2d', schemaVersion:1, sceneObjectId:id(1), elements:[{ id:id(2),kind:'label',anchor:'top-left',offset:[5,6],size:[200,32],fontSize:20,color:'#ffffff',content:{kind:'literal',text:'Start'} }] };
const original = '\ufeff{\r\n  "format": "viento-scene-hud2d",\r\n  "schemaVersion": 1,\r\n  "sceneObjectId": "' + id(1) + '",\r\n  "elements": ' + JSON.stringify(initial.elements) + '\r\n}\r\n';
const settle = async () => { for (let i=0;i<8;i++) await flushDialogs(); };
async function setup({ create = false, mode = 'normal', initialText = 'Start' } = {}) {
  let next = 99, requestCount = 0; const writes = [], commands = [];
  const context = { editable:true,busy:false,dirty:false,creating:false,visible:true,session:'session-1',sceneId:id(1),sourceToken:'source' };
  const catalog = { format:'viento-hud2d-author-context',schemaVersion:1,worldId:world,baseRevision:hash,documentRoot:'documents',documentTypes:[{id:'document',label:'Document'}],
    scene:{objectId:id(1),objectRevision:hash,sourcePath:'documents/scenes/a.json',sourceRevision:hash,viewport:[640,480]},
    manifest:create?null:{objectId:id(3),sourcePath:'documents/hud/a.json',sourceRevision:hash,content:original.replace('\"Start\"', JSON.stringify(initialText))} };
  const h=await dialogHarness('app-scene-hud2d',{inspectSceneHUD2DDocument,resolveSceneHUD2DView: value => resolveSceneHUD2DView(JSON.parse(JSON.stringify(value))),parseJsonSource,locateJsonSource,crypto:{randomUUID:()=>id(++next)}});
  const api=h.runtime.setupSceneHUD2D({getContext:()=>context,inspect:async()=>structuredClone(catalog),command:async input=>{commands.push(structuredClone(input));if(input.mode==='apply')catalog.manifest={objectId:input.objectId,sourcePath:input.sourcePath,sourceRevision:hash,content:input.content};return {status:input.mode==='preview'?'preview':'applied',worldId:world,baseRevision:hash};},
    request:async input=>{writes.push(structuredClone(input));requestCount++;if(mode==='conflict'&&requestCount===1)throw Object.assign(Error('conflict'),{code:'scene_hud2d_document_conflict'});if(mode==='dependency'&&requestCount===1)throw Object.assign(Error('invalid dependency'),{code:'build_hud2d_invalid'});if(mode==='unknown'&&requestCount===1)throw Error('connection lost');catalog.manifest.content=input.content;return {status:'applied'};}});
  api.setAvailable(true,['hud2d.create']);await api.open(id(1));const el=name=>h.element('sceneHUD2D'+name);
  return {api,context,catalog,writes,commands,el,set(name,value){el(name).value=value;el(name).dispatch('input');},async click(name){el(name).click();await settle();},
    async choose(index){el('List').children[index].children[0].click();await settle();}};
}

test('new HUD authors ordered text and state bar through review and explicit creation',async()=>{
 const h=await setup({create:true});await h.click('AddLabel');h.set('Text','Score');await h.click('AddBar');h.set('Key','energy');h.set('Anchor','bottom-right');h.set('X','-10');h.set('Min','0');h.set('Max','100');
 await h.click('Up');assert.equal(h.commands.length,0);await h.click('Check');assert.equal(h.commands.length,1);assert.equal(h.commands[0].mode,'preview');
 const doc=JSON.parse(h.el('ReviewText').textContent);assert.deepEqual(doc.elements.map(x=>x.kind),['bar','label']);assert.equal(doc.elements[0].key,'energy');assert.equal(doc.elements[0].anchor,'bottom-right');assert.equal(doc.elements[1].content.text,'Score');
 await h.click('Save');assert.equal(h.commands.length,2);assert.equal(h.commands[1].mode,'apply');assert.equal(h.commands[1].content,h.commands[0].content);assert.equal(h.writes.length,0);
});

test('samples do not alter author data, dirty state or a reviewed ticket',async()=>{
 const h=await setup();h.set('Text','Changed');await h.click('Check');const review=h.el('ReviewText').textContent;assert.equal(h.el('Save').disabled,false);
 h.set('Sample','false');h.set('SampleNumber','90');assert.equal(h.el('Save').disabled,false);assert.equal(h.el('ReviewText').textContent,review);assert.equal(h.writes.length,0);
});

test('invalid field clears approval and cancel never saves',async()=>{
 const h=await setup();h.set('Width','0');await h.click('Check');assert.equal(h.el('Save').disabled,true);assert.equal(h.writes.length,0);await h.click('Cancel');assert.equal(h.el('Dialog').open,false);assert.equal(h.writes.length,0);
});

test('known save conflict preserves draft, revokes ticket and next explicit review saves while preserving surrounding source bytes',async()=>{
 const h=await setup({mode:'conflict'});h.set('Text','Hello\nworld');await h.click('Check');await h.click('Save');assert.equal(h.writes.length,1);assert.equal(h.el('Save').disabled,true);assert.equal(h.el('Text').value,'Hello\nworld');
 await h.click('Check');await h.click('Save');assert.equal(h.writes.length,2);assert.ok(h.writes[1].content.startsWith('\ufeff{\r\n'));assert.ok(h.writes[1].content.endsWith('\r\n}\r\n'));assert.equal(JSON.parse(h.writes[1].content.slice(1)).elements[0].content.text,'Hello\nworld');
});

test('unknown write outcome allows only reconciliation, never a second write',async()=>{
 const h=await setup({mode:'unknown'});h.set('Text','Pending');await h.click('Check');await h.click('Save');assert.equal(h.writes.length,1);assert.equal(h.el('Save').disabled,true);await h.click('Save');assert.equal(h.writes.length,1);await h.click('Cancel');assert.equal(h.el('Dialog').open,true);
 h.catalog.manifest.content=h.writes[0].content;await h.click('Refresh');assert.equal(h.el('Dialog').open,true);assert.equal(h.el('Save').disabled,true);assert.equal(h.el('Text').value,'Pending');assert.equal(h.writes.length,1);
});

test('losing scene ownership blocks edits and writes from old elements',async()=>{
 const h=await setup();h.context.sceneId=id(9);h.set('Text','Wrong scene');await h.click('AddBar');await h.click('Check');assert.equal(h.writes.length,0);assert.equal(h.commands.length,0);assert.equal(h.el('Save').disabled,true);
});

test('a known prepublication HUD dependency rejection retains the draft for another review',async()=>{
 const h=await setup({mode:'dependency'});h.set('Text','Retain me');await h.click('Check');await h.click('Save');assert.equal(h.writes.length,1);assert.equal(h.el('Text').value,'Retain me');assert.equal(h.el('Save').disabled,true);assert.equal(h.el('Check').disabled,false);await h.click('Check');assert.equal(h.el('Save').disabled,false);
});

test('preview draws CR/LF as independent clipped non-wrapping lines and TAB on the same line without altering source text',async()=>{
 const h=await setup({initialText:'A\r\nB\tC'}),calls=[];const context={clearRect(){},fillRect(){},save(){},restore(){},translate(){},scale(){},beginPath(){},rect(...args){calls.push({kind:'rect',args});},clip(){calls.push({kind:'clip'});},measureText(text){return {width:text.length*5};},fillText(...args){calls.push({kind:'text',args});}};
 const canvas=h.el('Canvas');canvas.getContext=()=>context;canvas.getBoundingClientRect=()=>({width:500,height:300});
 h.set('Sample','missing');const texts=calls.filter(row=>row.kind==='text').map(row=>row.args);assert.deepEqual(texts.map(row=>row[0]),['A','B','C']);assert.equal(texts[1][2]-texts[0][2],62);assert.equal(texts[1][2],texts[2][2]);assert.ok(texts[2][1]>texts[1][1]);assert.ok(calls.filter(row=>row.kind==='clip').length>=2);assert.equal(JSON.parse(canvas.dataset.view).elements[0].text,'A\r\nB\tC');assert.equal(h.writes.length,0);
 calls.length=0;h.set('Width','1');h.set('Text','Long text stays on one line');assert.deepEqual(calls.filter(row=>row.kind==='text').slice(-1)[0].args[0],'Long text stays on one line');assert.equal(JSON.parse(canvas.dataset.view).elements[0].text,'Long text stays on one line');
});
