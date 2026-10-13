import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {editorHarness} from './editor-harness.mjs';

test('shared source context does not change when a read-only navigation moves focus selection or scroll',async()=>{
 const writes=[],h=await editorHarness({writeDoc:async p=>{writes.push(p);return{version:'2'};}});
 for(const dirty of [false,true]){
  h.begin('\uFEFFone\r\ntwo\r\n','original');if(dirty){h.source.value+='three';h.runtime.handleSourceInput();}
  const before={text:h.runtime.getCurrentEditContent(),token:h.runtime.sourceEditorContext().sourceToken,draft:h.runtime.captureEditorDraft(),dirty:h.state.editHasUnsavedChanges,version:h.state.activeEditSourceVersion};
  h.source.focus();h.source.setSelectionRange(5,5);h.source.scrollTop=42;h.source.scrollLeft=0;
  assert.equal(h.runtime.sourceEditorContext().sourceToken,before.token);assert.equal(h.runtime.getCurrentEditContent(),before.text);assert.deepEqual(h.runtime.captureEditorDraft(),before.draft);assert.equal(h.state.editHasUnsavedChanges,before.dirty);assert.equal(h.state.activeEditSourceVersion,before.version);
 }
 assert.deepEqual(writes,[]);
});

test('ordinary source input refreshes both independent source tools without adding persistence operations',async()=>{
 const writes=[],h=await editorHarness({writeDoc:async p=>{writes.push(p);return{version:'2'};}});h.begin('one\n','1');h.runtime.__toolRefresh=[];
 vm.runInContext('sourceIndentationController={refresh(){__toolRefresh.push("indent")}};sourcePositionController={refresh(){__toolRefresh.push("position")}};',h.runtime);
 const token=h.runtime.sourceEditorContext().sourceToken;h.source.value+='two';h.runtime.handleSourceInput();assert.deepEqual([...h.runtime.__toolRefresh],['indent','position']);assert.equal(h.runtime.sourceEditorContext().sourceToken,token);assert.equal(h.state.editHasUnsavedChanges,true);assert.deepEqual(writes,[]);
 h.runtime.__toolRefresh=[];h.runtime.setSourceEditorContent('new\nsource');assert.deepEqual([...h.runtime.__toolRefresh],['indent','position']);assert.notEqual(h.runtime.sourceEditorContext().sourceToken,token);
});

test('busy and mode refresh revoke navigation context without replacing the source or discarding its draft',async()=>{
 const h=await editorHarness();h.begin('one\n','1');h.source.value+='draft';h.runtime.handleSourceInput();const before=h.runtime.getCurrentEditContent();
 for(const [key,value] of [['isSaving',true],['isLoadingSource',true],['isMutatingWorld',true],['editInputMode','fields'],['mode','browse'],['editBackendAvailable',false]]){
  const old=h.state[key];h.state[key]=value;assert.equal(h.runtime.sourceEditorContext().editable,false,key);h.state[key]=old;assert.equal(h.runtime.getCurrentEditContent(),before);assert.equal(h.state.editHasUnsavedChanges,true);
 }
 assert.equal(h.runtime.sourceEditorContext().editable,true);
});
