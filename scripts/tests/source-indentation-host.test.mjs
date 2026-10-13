import test from 'node:test';
import assert from 'node:assert/strict';
import {editorHarness} from './editor-harness.mjs';

test('source indentation is available only to the current writable source session',async()=>{
 const h=await editorHarness();assert.equal(h.runtime.sourceEditorContext().editable,false);h.begin();assert.equal(h.runtime.sourceEditorContext().editable,true);
 for(const [key,value] of [['mode','browse'],['editBackendAvailable',false],['editInputMode','blocks'],['editInputMode','fields'],['isSaving',true],['isRebuilding',true],['isLoadingSource',true],['isLoadingTemplate',true],['isLoadingFields',true],['isImportingMedia',true],['isExporting',true],['isConfiguringProject',true],['isMutatingWorld',true]]){
  const old=h.state[key];h.state[key]=value;assert.equal(h.runtime.sourceEditorContext().editable,false,key);h.state[key]=old;
 }
 h.state.isCreating=true;assert.equal(h.runtime.sourceEditorContext().editable,true);h.runtime.resetDocEditorState();assert.equal(h.runtime.sourceEditorContext().editable,false);
});

test('ordinary input and status repaint preserve the source identity while navigation and source reload change it',async()=>{
 const h=await editorHarness();h.begin();const token=h.runtime.sourceEditorContext().sourceToken;
 h.source.value+='新文字';h.runtime.handleSourceInput();assert.equal(h.runtime.sourceEditorContext().sourceToken,token);
 h.runtime.updateEditUnsavedUi();assert.equal(h.runtime.sourceEditorContext().sourceToken,token);
 h.state.activeEditSource='documents/scripts/another.txt';const next=h.runtime.sourceEditorContext().sourceToken;assert.notEqual(next,token);
 h.runtime.invalidateEditorLoads();assert.notEqual(h.runtime.sourceEditorContext().sourceToken,next);
 const loaded=h.runtime.sourceEditorContext().sourceToken;h.runtime.setSourceEditorContent('new loaded text\n\tpass');assert.notEqual(h.runtime.sourceEditorContext().sourceToken,loaded);
});

test('source tools use ordinary dirty tracking and Save, preserving BOM and CRLF serialization',async()=>{
 const writes=[],h=await editorHarness({writeDoc:async p=>{writes.push(p);return{version:'2'};}});h.runtime.rebuildIndexForDoc=async()=>{};
 const before='\uFEFFextends Node\r\n\r\nfunc _ready():\r\n\tpass\r\n';h.begin(before,'1');h.source.value='\uFEFFextends Node\n\nfunc _ready():\n\t\tpass\n';h.runtime.handleSourceInput();
 assert.equal(h.state.editHasUnsavedChanges,true);assert.equal(writes.length,0);assert.equal(h.runtime.getCurrentEditContent(),before.replace('\tpass','\t\tpass'));
 // Native undo is exercised in Chrome; here its ordinary input result clears dirty state.
 h.source.value=before;h.runtime.handleSourceInput();assert.equal(h.state.editHasUnsavedChanges,false);
 h.source.value=before.replace('\tpass','\t\tpass');h.runtime.handleSourceInput();await h.runtime.saveCurrentDoc();assert.equal(writes.length,1);assert.equal(writes[0].content,before.replace('\tpass','\t\tpass'));assert.equal(h.state.editHasUnsavedChanges,false);
});

test('failed ordinary Save retains indented source and leaves retry to the existing save workflow',async()=>{
 const writes=[],h=await editorHarness({writeDoc:async p=>{writes.push(p);throw Error('conflict');}});h.runtime.logRuntimeErrorOrMessage=(_label,e)=>e.message;h.begin('one\ntwo\n','1');h.source.value='  one\n  two\n';h.runtime.handleSourceInput();await h.runtime.saveCurrentDoc();
 assert.equal(writes.length,1);assert.equal(h.runtime.getCurrentEditContent(),'  one\n  two\n');assert.equal(h.state.editHasUnsavedChanges,true);assert.equal(h.state.isSaving,false);assert.match(h.element('docEditStatus').textContent,/conflict/);
});
