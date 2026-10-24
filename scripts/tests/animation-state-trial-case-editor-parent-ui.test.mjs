import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { createAnimationStateTrialSequence, previewAnimationStateTrialStep, appendAnimationStateTrialStep } from '../../engine/animation-state-trial-sequence.mjs';
import { createAnimationStateTrialCase, parseAnimationStateTrialCase, serializeAnimationStateTrialCase } from '../../engine/animation-state-trial-case.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));
const table=()=>({initialState:'idle',states:[{key:'idle'},{key:'attack'}],transitions:[{from:'idle',to:'attack',trigger:{kind:'event',name:'go',condition:{type:'number',operator:'gte',value:3}}},{from:'attack',to:'idle',trigger:{kind:'completed'}}]});
const event=value=>({kind:'event',event:{name:'go',value},projectState:[]});
const advance=(sequence,input)=>appendAnimationStateTrialStep(sequence,previewAnimationStateTrialStep(sequence,input));
const path=()=>advance(advance(createAnimationStateTrialSequence(table()),event(3)),{kind:'completed'});
const raw=()=>serializeAnimationStateTrialCase(createAnimationStateTrialCase(path()));
const defer=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {resolve,promise};};
async function fixture(t) {
 let source=table(),sequence=path();const context={active:true,visible:true,available:true,disabled:false,generation:1},blobs=[],revoked=[];
 const h=await dialogHarness('app-animation-state-trial-case',{URL:{createObjectURL(blob){blobs.push(blob);return 'blob:case-'+blobs.length;},revokeObjectURL(value){revoked.push(value);}}});
 const container=h.document.createElement('div');h.document.body.append(container);
 const translate=(key,...args)=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[i]??''));
 const controller=h.runtime.setupAnimationStateTrialCase({container,idPrefix:'case',getContext:()=>context,getTable:()=>source,getSequence:()=>sequence,translate});t.after(()=>controller.dispose());controller.refresh();
 const el=suffix=>h.element('case'+suffix),editor=suffix=>el('Editor'+suffix);
 return {...h,controller,context,container,el,editor,blobs,revoked,path:()=>sequence,source:()=>copy(source),rows:()=>el('Steps').children,
  setPath(value){sequence=value;controller.refresh();},change(value){source=copy(value);controller.refresh();},
  start(text=raw(),promise){el('Import').click();el('File').files=[{name:'imported.json',size:text.length,text:()=>promise??Promise.resolve(text)}];el('File').dispatch('change');},
  async load(text){this.start(text);await flushDialogs();},run(){el('Run').click();},edit(){el('Edit').click();},create(){el('Create').click();},write(text){editor('Text').value=text;editor('Text').dispatch('input');},check(){editor('Check').click();},apply(){editor('Apply').click();},cancel(){editor('Cancel').click();}};
}

test('creating from a recorded path starts a readable draft without loading or replaying until applied',async t=>{
 const h=await fixture(t),pathBefore=h.path(),sourceBefore=h.source();h.create();assert.equal(h.editor('Panel').hidden,false);assert.equal(h.el('Loaded').hidden,true);assert.equal(h.el('Result').hidden,true);assert.match(h.editor('Text').value,/\n  "format"/);h.check();assert.equal(h.el('Loaded').hidden,true);h.apply();assert.equal(h.editor('Panel').hidden,true);assert.equal(h.el('Loaded').hidden,false);assert.equal(h.el('Result').hidden,true);assert.match(h.el('Status').textContent,/已应用.*尚未重跑/);assert.equal(h.path(),pathBefore);assert.deepEqual(h.source(),sourceBefore);h.run();assert.equal(h.el('Result').dataset.status,'passed');
});

test('invalid edits and cancel preserve the loaded case report and return focus to edit',async t=>{
 const h=await fixture(t);await h.load();h.run();const row=h.rows()[0],loaded=h.el('LoadedSummary').textContent;h.edit();h.write('{ invalid');h.check();assert.equal(h.editor('Text').value,'{ invalid');assert.equal(h.editor('Apply').disabled,true);assert.equal(h.rows()[0],row);assert.equal(h.el('LoadedSummary').textContent,loaded);h.cancel();assert.equal(h.rows()[0],row);assert.equal(h.el('Result').dataset.status,'passed');assert.equal(h.document.activeElement,h.el('Edit'));
});

test('a new path draft does not replace an already loaded case before apply and can be cancelled',async t=>{
 const h=await fixture(t);await h.load();h.run();const row=h.rows()[0],loaded=h.el('LoadedSummary').textContent;h.setPath(advance(createAnimationStateTrialSequence(table()),event(2)));h.create();assert.equal(JSON.parse(h.editor('Text').value).steps[0].input.event.value,2);assert.equal(h.rows()[0],row);h.cancel();assert.equal(h.el('LoadedSummary').textContent,loaded);assert.equal(h.rows()[0],row);assert.equal(h.document.activeElement,h.el('Create'));
});

test('editing locks all conflicting parent controls and their forced handlers preserve the draft',async t=>{
 const h=await fixture(t);await h.load();h.run();const row=h.rows()[0];h.edit();h.write('{ unfinished');for(const name of['Import','Clear','Run','Create','Edit','ExportLoaded','Export']){assert.equal(h.el(name).disabled,true,name);h.el(name).disabled=false;h.el(name).click();assert.equal(h.editor('Text').value,'{ unfinished',name);assert.equal(h.editor('Panel').hidden,false,name);assert.equal(h.rows()[0],row,name);}assert.equal(h.blobs.length,0);h.cancel();
});

test('explicit apply replaces expectations only and clears replay without updating the manual sequence',async t=>{
 const h=await fixture(t);await h.load();h.run();const before=h.path();h.edit();const draft=JSON.parse(h.editor('Text').value);draft.steps[0].input.event.value=2;h.write(JSON.stringify(draft));h.check();h.apply();assert.equal(h.el('Result').hidden,true);assert.equal(h.path(),before);h.run();assert.deepEqual(h.rows().map(row=>row.dataset.status),['failed','not-run']);h.edit();draft.steps[0].expected={stateKey:'idle',transition:false};draft.steps[1].expected={stateKey:'idle',transition:false};h.write(JSON.stringify(draft));h.check();h.apply();h.run();assert.deepEqual(h.rows().map(row=>row.dataset.status),['passed','passed']);assert.equal(h.path(),before);
});

test('export loaded case reflects applied JSON rather than the current path or unfinished draft',async t=>{
 const h=await fixture(t);await h.load();h.edit();const draft=JSON.parse(h.editor('Text').value);draft.steps[0].input.event.value=2;draft.steps[0].expected={stateKey:'idle',transition:false};draft.steps[1].expected={stateKey:'idle',transition:false};h.write(JSON.stringify(draft));h.check();h.apply();h.el('ExportLoaded').click();const loaded=parseAnimationStateTrialCase(await h.blobs[0].text());assert.equal(loaded.steps[0].input.event.value,2);h.el('Export').click();const recorded=parseAnimationStateTrialCase(await h.blobs[1].text());assert.equal(recorded.steps[0].input.event.value,3);assert.equal(h.blobs[0].type,'application/json;charset=utf-8');for(const callback of h.timers.values())callback();assert.deepEqual(h.revoked,['blob:case-1','blob:case-2']);
});

test('opening edit revokes pending file reads even after applying and a late read cannot overwrite it',async t=>{
 const h=await fixture(t);await h.load();const pending=defer();h.start(raw(),pending.promise);h.edit();const draft=JSON.parse(h.editor('Text').value);draft.steps[0].input.event.value=2;h.write(JSON.stringify(draft));h.check();h.apply();pending.resolve(raw());await flushDialogs();h.el('ExportLoaded').click();assert.equal(parseAnimationStateTrialCase(await h.blobs[0].text()).steps[0].input.event.value,2);
});

test('creating a case revokes a previously opened file chooser and preserves raw draft',async t=>{
 const h=await fixture(t);h.el('Import').click();h.create();const before=h.editor('Text').value;let reads=0;h.el('File').files=[{name:'late.json',size:2,text(){reads++;return Promise.resolve('{}');}}];h.el('File').dispatch('change');await flushDialogs();assert.equal(reads,0);assert.equal(h.editor('Text').value,before);assert.equal(h.el('Loaded').hidden,true);
});

test('author changes revoke only replay while retaining editor text and a successful definition check',async t=>{
 const h=await fixture(t);await h.load();h.run();h.edit();h.check();const before=h.editor('Text').value,changed=h.source();changed.transitions[0].trigger.condition.value=4;h.context.generation++;h.change(changed);assert.equal(h.el('Result').hidden,true);assert.equal(h.editor('Text').value,before);assert.equal(h.editor('Apply').disabled,false);h.apply();h.run();assert.equal(h.el('Result').dataset.status,'failed');
});

test('folding keeps draft but revokes check; reset and inactive sessions clear it with the loaded case',async t=>{
 const h=await fixture(t);await h.load();h.edit();h.write('{ unfinished');const raw=h.editor('Text').value;h.context.visible=false;h.controller.refresh();h.context.visible=true;h.controller.refresh();assert.equal(h.editor('Text').value,raw);assert.equal(h.editor('Apply').disabled,true);h.controller.reset();assert.equal(h.editor('Panel').hidden,true);assert.equal(h.editor('Text').value,'');assert.equal(h.el('Loaded').hidden,true);h.create();h.context.active=false;h.controller.refresh();h.context.active=true;h.controller.refresh();assert.equal(h.editor('Panel').hidden,true);assert.equal(h.editor('Text').value,'');
});

test('Escape cancellation stays inside the editor and IME Escape leaves it open',async t=>{
 const h=await fixture(t);await h.load();h.edit();h.editor('Text').dispatch('keydown',{key:'Escape',isComposing:true,bubbles:true});assert.equal(h.editor('Panel').hidden,false);const event=h.editor('Text').dispatch('keydown',{key:'Escape',bubbles:true});assert.equal(event.stopped,true);assert.equal(event.defaultPrevented,true);assert.equal(h.editor('Panel').hidden,true);assert.equal(h.el('Loaded').hidden,false);assert.equal(h.document.activeElement,h.el('Edit'));
});

test('large readable formatting falls back to bounded compact JSON without dropping samples',async t=>{
 const h=await fixture(t),declaration={initialState:'idle',states:[{key:'idle'}],transitions:[]};let sequence=createAnimationStateTrialSequence(declaration);const input={kind:'event',event:{name:'sample',value:false},projectState:Array.from({length:64},(_,i)=>({key:'key'+i,value:false}))};
 for(let i=0;i<32;i++){try{sequence=advance(sequence,input);}catch{break;}}
 const value=createAnimationStateTrialCase(sequence),pretty=JSON.stringify(value,null,2)+'\n';assert.ok(new TextEncoder().encode(pretty).length>131072);h.setPath(sequence);h.create();assert.equal(h.editor('Text').value,serializeAnimationStateTrialCase(value));assert.ok(new TextEncoder().encode(h.editor('Text').value).length<=131072);h.check();assert.equal(h.editor('Apply').disabled,false);
});
