import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareScriptDraft} from '../../engine/script-authoring.mjs';
import {editorHarness,deferred} from './editor-harness.mjs';
const clone=value=>structuredClone(value);
async function harness(options={}) {
 const reads=[],writes=[],templates=[];
 const h=await editorHarness({readDocSource:async input=>{reads.push(input);return {content:'old',version:'1'};},
  loadTemplateContent:async input=>{templates.push(input);return options.template?options.template(input):'ordinary template';},
  writeDoc:async input=>{writes.push(input);return options.write?options.write(input):{version:'saved-script'};}});
 h.state.workspace={version:options.version||3,paths:{documents:options.version===2?'design-data':'documents'},documentTypes:[{id:'notes',label:'Notes',directory:'notes',parserProfile:'structured',template:'notes.md',templateSource:'templates/notes.md'}]};
 h.runtime.rebuildIndexForDoc=async()=>{};h.runtime.logRuntimeErrorOrMessage=(_label,error)=>error.message;
 const context=()=>{const {sourceToken,documentRoot,documentTypes}=h.runtime.scriptCreateContext();return clone({sourceToken,documentRoot,documentTypes});};
 const prepare=(patch={})=>prepareScriptDraft(context(),{starterId:'godot-node',documentType:'notes',sourcePath:`${context().documentRoot}/scripts/hello.txt`,...patch});
 return{...h,reads,writes,templates,context,prepare};
}
for(const version of [2,3])for(const starterId of ['godot-node','godot-character-intent'])test(`script helper creates ${starterId} in workspace ${version}, then ordinary Save alone registers it`,async()=>{
 const h=await harness({version}),p=h.prepare({starterId}),before=clone(h.state.workspace),result=h.runtime.createScriptDraft(p);
 assert.equal(result.applied,true);assert.equal(h.state.isCreating,true);assert.equal(h.state.isEditing,true);assert.equal(h.state.editInputMode,'source');assert.equal(h.state.editHasUnsavedChanges,true);
 assert.equal(h.runtime.getCurrentEditContent(),p.content);assert.equal(h.element('docCreatePathInput').value,p.sourcePath);assert.equal(h.state.activeCreateType,'notes');assert.equal(h.state.activeEditSourceVersion,'');
 assert.equal(h.reads.length+h.writes.length+h.templates.length,0);assert.deepEqual(h.state.workspace,before);
 assert.equal(result.focus(),true);assert.equal(result.focus(),false);
 await h.runtime.saveCurrentDoc();assert.equal(h.writes.length,1);assert.equal(h.writes[0].content,p.content);assert.equal(h.writes[0].pathValue,p.sourcePath);assert.equal(h.writes[0].documentType,'notes');assert.equal(h.writes[0].isCreate,true);
 assert.equal(h.state.isCreating,false);assert.equal(h.state.editHasUnsavedChanges,false);assert.equal(h.state.activeEditSource,p.sourcePath);assert.equal(result.focus(),false);
});
test('empty generic projects can create the first script without requiring an active document or script type',async()=>{
 const h=await harness();h.state.docs=[];h.state.activePath='';h.runtime.rebuildDocPathCaches([]);assert.equal(h.runtime.createScriptDraft(h.prepare()).applied,true);assert.equal(h.state.editHasUnsavedChanges,true);
});
test('an existing clean editor session is replaced atomically and old source caches remain untouched',async()=>{
 const h=await harness();h.begin('existing saved source','old-version');const oldCache=h.doc._sourceCachedText;
 h.runtime.createScriptDraft(h.prepare({starterId:'godot-signal'}));assert.equal(h.doc._sourceCachedText,oldCache);assert.equal(h.state.activeEditSource,'');assert.match(h.runtime.getCurrentEditContent(),/signal arrived/);assert.equal(h.state.editHasUnsavedChanges,true);
});
test('stale source, workspace, catalog, mode and busy state refuse a prepared script before changing any source',async()=>{
 for(const change of ['workspace','types','path','busy','mode','silent-content','dirty','creating']){
  const h=await harness();h.begin('saved','1');const p=h.prepare();
  if(change==='workspace')h.state.workspace={...h.state.workspace};
  if(change==='types')h.state.workspace.documentTypes[0].label='Changed';
  if(change==='path')h.state.activePath='elsewhere';
  if(change==='busy')h.state.isSaving=true;
  if(change==='mode')h.state.mode='browse';
  if(change==='silent-content')h.source.value='draft without input event';
  if(change==='dirty'){h.source.value='dirty';h.runtime.refreshEditSessionDirtyState();}
  if(change==='creating')h.state.isCreating=true;
  const before=h.source.value;assert.throws(()=>h.runtime.createScriptDraft(p),{errorCode:'script_authoring_conflict'},change);assert.equal(h.source.value,before,change);assert.equal(h.writes.length,0);
 }
});
test('newly observed dirty or existing new-document drafts cannot be replaced, even by a fresh proposal',async()=>{
 for(const kind of ['dirty','creating']){
  const h=await harness();if(kind==='creating')await h.runtime.enterCreateMode();else{h.begin('saved','1');h.source.value='silently changed';}
  const content=h.source.value,p=h.prepare();assert.throws(()=>h.runtime.createScriptDraft(p),{errorCode:'script_authoring_conflict'});assert.equal(h.source.value,content);assert.equal(h.writes.length,0);
 }
});
test('UI ownership is checked again immediately before the draft transition, including a guard that changes the host',async()=>{
 for(const kind of ['false','mutating','invalid']){
  const h=await harness(),p=h.prepare();let calls=0;
  const isCurrent=kind==='invalid'?true:()=>{calls++;if(kind==='mutating'&&calls===2)h.state.isSaving=true;return kind!=='false';};
  assert.throws(()=>h.runtime.createScriptDraft(p,{isCurrent}),{errorCode:'script_authoring_conflict'});assert.equal(h.state.isCreating,false);assert.equal(h.writes.length,0);
 }
});
test('serialized and forged proposals cannot acquire source write authority',async()=>{
 const h=await harness(),p=h.prepare();for(const bad of [clone(p),{...p,content:'foreign'},null])assert.throws(()=>h.runtime.createScriptDraft(bad));assert.equal(h.state.isCreating,false);assert.equal(h.writes.length,0);
});
test('failed ordinary create keeps exact TXT path, selected project type and modified source draft for retry',async()=>{
 let attempts=0;const h=await harness({write:()=>{if(++attempts===1)throw Error('occupied path');return{version:'saved'};}});h.runtime.createScriptDraft(h.prepare());h.source.value+='\n# author text\n';h.runtime.refreshEditSessionDirtyState();
 await h.runtime.saveCurrentDoc();assert.equal(h.state.isCreating,true);assert.equal(h.state.editHasUnsavedChanges,true);assert.match(h.source.value,/# author text/);assert.match(h.element('docEditStatus').textContent,/occupied path/);
 await h.runtime.saveCurrentDoc();assert.equal(h.writes.length,2);assert.equal(h.writes[0].pathValue,h.writes[1].pathValue);assert.equal(h.writes[1].documentType,'notes');assert.equal(h.state.isCreating,false);
});
test('cancelled old template responses cannot overwrite a newly seeded script draft',async()=>{
 const waiting=deferred(),h=await harness({template:()=>waiting.promise});const older=h.runtime.enterCreateMode();assert.equal(h.state.isLoadingTemplate,true);
 h.runtime.resetDocEditorState();h.runtime.createScriptDraft(h.prepare());waiting.resolve('LATE ORDINARY TEMPLATE');await older;
 assert.equal(h.runtime.getCurrentEditContent(),'extends Node\n');assert.equal(h.state.activeCreatePath,'documents/scripts/hello.txt');assert.equal(h.state.editHasUnsavedChanges,true);
});
test('focus waits until the chooser closes and is invalidated by new edits, path, type or session changes',async()=>{
 const h=await harness(),result=h.runtime.createScriptDraft(h.prepare());h.runtime.document.querySelector=()=>({});assert.equal(result.focus(),false);h.runtime.document.querySelector=()=>null;assert.equal(result.focus(),true);
 for(const action of ['content','path','type','cancel','mode']){
  const g=await harness(),receipt=g.runtime.createScriptDraft(g.prepare());
  if(action==='content')g.source.value+='changed';if(action==='path')g.element('docCreatePathInput').value='documents/scripts/other.txt';if(action==='type')g.state.activeCreateType='other';if(action==='cancel')g.runtime.resetDocEditorState();if(action==='mode')g.state.mode='browse';
  assert.equal(receipt.focus(),false,action);
 }
});
test('delayed script chooser focus preserves newer navigation selection and scroll',async()=>{
 const h=await harness(),receipt=h.runtime.createScriptDraft(h.prepare({starterId:'godot-signal'}));
 assert.equal(h.source.selectionStart,0);assert.equal(h.source.selectionEnd,0);
 h.runtime.document.querySelector=()=>({});assert.equal(receipt.focus(),false);
 // Go-to-line or a user selection can finish before the native chooser close
 // event delivers its pending focus receipt.
 h.source.selectionStart=24;h.source.selectionEnd=31;h.source.selectionDirection='backward';h.source.scrollTop=140;h.source.scrollLeft=18;
 const before={text:h.source.value,start:h.source.selectionStart,end:h.source.selectionEnd,direction:h.source.selectionDirection,top:h.source.scrollTop,left:h.source.scrollLeft};
 const focusOptions=[];h.source.focus=options=>{focusOptions.push(clone(options));if(!options?.preventScroll){h.source.scrollTop=0;h.source.scrollLeft=0;}};
 h.runtime.document.querySelector=()=>null;
 assert.equal(receipt.focus(),true);assert.deepEqual(focusOptions,[{preventScroll:true}]);
 assert.deepEqual({text:h.source.value,start:h.source.selectionStart,end:h.source.selectionEnd,direction:h.source.selectionDirection,top:h.source.scrollTop,left:h.source.scrollLeft},before);
 assert.equal(receipt.focus(),false);assert.equal(focusOptions.length,1);assert.equal(h.writes.length,0);
});
test('script focus receipt performs no trailing selection or source writes after a reentrant focus listener',async()=>{
 for(const switchSource of [false,true]){
  const h=await harness(),receipt=h.runtime.createScriptDraft(h.prepare());let selections=0;
  h.source.setSelectionRange=()=>{selections++;};
  h.source.focus=()=>{
   if(switchSource){h.runtime.setSourceEditorContent('different source document');h.state.activeEditSource='documents/notes/other.txt';h.state.isCreating=false;}
   h.source.selectionStart=4;h.source.selectionEnd=9;h.source.selectionDirection='backward';h.source.scrollTop=67;h.source.scrollLeft=12;
  };
  receipt.focus();
  assert.equal(h.source.value,switchSource?'different source document':'extends Node\n');
  assert.deepEqual([h.source.selectionStart,h.source.selectionEnd,h.source.selectionDirection,h.source.scrollTop,h.source.scrollLeft],[4,9,'backward',67,12]);
  assert.equal(selections,0);assert.equal(h.writes.length,0);assert.equal(receipt.focus(),false);
 }
});
test('script context tokens remain stable for identical state but change after a catalog or document identity transition',async()=>{
 const h=await harness(),first=h.context();assert.equal(h.context().sourceToken,first.sourceToken);h.state.workspace.documentTypes=[...h.state.workspace.documentTypes];assert.equal(h.context().sourceToken,first.sourceToken);
 h.state.workspace.documentTypes[0]={...h.state.workspace.documentTypes[0],label:'Nouveau'};assert.notEqual(h.context().sourceToken,first.sourceToken);const second=h.context();h.state.docs=[{...h.doc}];h.runtime.rebuildDocPathCaches(h.state.docs);assert.notEqual(h.context().sourceToken,second.sourceToken);
});

test('leaving saved source editing settles scene ownership before later language UI refreshes',async()=>{
 for(const path of ['documents/scripts/hello.txt','documents/scenes/test.json']){
  const h=await harness();h.begin('saved source','revision');h.state.activeEditSource=path;h.runtime.updateEditUnsavedUi();
  const before=h.runtime.scene3DSourceContext().sourceToken;
  h.runtime.applyEditMode(h.doc,false);
  const closed=h.runtime.scene3DSourceContext().sourceToken;
  assert.notEqual(closed,before);assert.equal(h.state.activeEditSource,'');assert.equal(h.source.value,'');
  for(let language=0;language<3;language++){
   h.runtime.updateEditUnsavedUi();
   assert.equal(h.runtime.scene3DSourceContext().sourceToken,closed,'language/status repaint must not discover a deferred source transition');
  }
 }
});
