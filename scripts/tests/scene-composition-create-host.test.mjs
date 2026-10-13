import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCompositionDraft } from '../../engine/scene-composition-create.mjs';
import { planCompositionCreateLayout } from '../../engine/scene-composition-create-layout.mjs';
import { prepareScriptDraft } from '../../engine/script-authoring.mjs';
import { editorHarness } from './editor-harness.mjs';
const clone = value => structuredClone(value);
const id = number => `${String(number).padStart(8,'0')}-1111-4111-8111-111111111111`;
const rev = letter => `sha256:${letter.repeat(64)}`;
async function fixture(options = {}) {
  const writes = [], reads = [];
  const h = await editorHarness({ writeDoc: async request => { writes.push(request); return options.write ? options.write(request) : {version:'saved'}; },
    readDocSource: async request => { reads.push(request); return {content:'old',version:'old'}; } });
  h.state.workspace = {version: options.version || 3, paths:{documents: options.version === 2 ? 'design-data' : 'documents'},
    documentTypes:[{id:'note',label:'Notes',directory:'notes',parserProfile:'structured',template:'note.md',templateSource:'templates/note.md'}]};
  h.runtime.rebuildIndexForDoc = async () => {}; h.runtime.logRuntimeErrorOrMessage = (_label,error) => error.message;
  const context = () => { const {sourceToken,documentRoot,documentTypes} = h.runtime.compositionCreateContext(); return clone({sourceToken,documentRoot,documentTypes}); };
  const catalog = () => ({format:'viento-scene-composition-create-context',schemaVersion:1,worldId:'world:fixture',worldRevision:rev('a'),
    documentRoot:context().documentRoot,documentTypes:context().documentTypes,existingPaths:[`${context().documentRoot}/actor.md`],existingIdentities:[id(1)],
    objects:[{id:id(1),name:'Traveler',sourcePath:`${context().documentRoot}/actor.md`,sourceRevision:rev('b'),canInheritProjection:true}]});
  const request = () => ({documentType:'note',sourcePath:`${context().documentRoot}/compositions/旅途.json`,title:'旅途',fragmentId:'party',actorKey:'hero',objectId:id(1),
    useProjectionDefaults:true,position:[160,120],viewport:[800,480],background:'#102030',placementId:id(2),instanceId:id(3)});
  const prepare = () => {const savedCatalog = catalog();return {proposal:prepareCompositionDraft(context(),savedCatalog,request()),catalog:savedCatalog};};
  const apply = ({proposal,catalog}, options={}) => h.runtime.createCompositionDraft(proposal,{catalog,...options});
  return {...h,writes,reads,context,catalog,request,prepare,apply};
}
for (const version of [2,3]) test(`composition helper seeds ordinary unsaved JSON in workspace ${version}; only Save writes`,async()=>{
  const h=await fixture({version}), input=h.prepare(), before=clone(h.state.workspace), receipt=h.apply(input);
  assert.equal(receipt.applied,true);assert.equal(h.state.isCreating,true);assert.equal(h.state.editInputMode,'source');assert.equal(h.state.editHasUnsavedChanges,true);
  assert.equal(h.source.value,input.proposal.content);assert.equal(h.state.activeCreateType,'note');assert.equal(h.element('docCreatePathInput').value,input.proposal.sourcePath);
  const actor=JSON.parse(h.source.value).fragments[0].actors[0];assert.equal(actor.useProjectionDefaults,true);assert.equal(Object.hasOwn(actor,'size'),false);
  assert.equal(h.reads.length+h.writes.length,0);assert.deepEqual(h.state.workspace,before);
  await h.runtime.saveCurrentDoc();assert.equal(h.writes.length,1);assert.equal(h.writes[0].content,input.proposal.content);assert.equal(h.writes[0].isCreate,true);
  assert.equal(h.writes[0].documentType,'note');assert.equal(h.state.isCreating,false);assert.equal(h.state.editHasUnsavedChanges,false);
});
test('dirty, busy, changed context and existing new drafts cannot be replaced by composition creation',async()=>{
  for(const kind of ['dirty','silent','busy','workspace','type','mode','creating']){
    const h=await fixture();h.begin('saved','1');const input=h.prepare();
    if(kind==='dirty'){h.source.value='author draft';h.runtime.refreshEditSessionDirtyState();}
    if(kind==='silent')h.source.value='silent author draft';
    if(kind==='busy')h.state.isImportingMedia=true;
    if(kind==='workspace')h.state.workspace={...h.state.workspace};
    if(kind==='type')h.state.workspace.documentTypes[0].label='Changed';
    if(kind==='mode')h.state.mode='browse';
    if(kind==='creating')h.state.isCreating=true;
    const before=h.source.value;assert.throws(()=>h.apply(input),{errorCode:'composition_authoring_conflict'},kind);assert.equal(h.source.value,before);assert.equal(h.writes.length,0);
  }
});
test('a changed World or candidate source cannot hand off an earlier reviewed composition',async()=>{
  for(const change of [c=>c.worldRevision=rev('c'),c=>c.objects[0].sourceRevision=rev('d'),c=>c.objects=[],c=>c.existingPaths.push('documents/new.md')]){
    const h=await fixture(),input=h.prepare();change(input.catalog);assert.throws(()=>h.apply(input),{errorCode:'composition_authoring_conflict'});assert.equal(h.state.isCreating,false);assert.equal(h.writes.length,0);
  }
});
test('composition and script proposals cannot substitute for each other or cross a serialized boundary',async()=>{
  const h=await fixture(),input=h.prepare(),script=prepareScriptDraft(h.context(),{starterId:'godot-node',documentType:'note',sourcePath:'documents/script.txt'});
  for(const proposal of [clone(input.proposal),{...input.proposal,content:'foreign'},script,null])assert.throws(()=>h.apply({...input,proposal}));
  assert.throws(()=>h.runtime.createScriptDraft(input.proposal));assert.equal(h.state.isCreating,false);assert.equal(h.writes.length,0);
});
test('composition ownership is checked again immediately before the synchronous new draft transition',async()=>{
  for(const kind of ['false','mutating','invalid']){
    const h=await fixture(),input=h.prepare();let calls=0;
    const isCurrent=kind==='invalid'?true:()=>{calls++;if(kind==='mutating'&&calls===2)h.state.isSaving=true;return kind!=='false';};
    assert.throws(()=>h.apply(input,{isCurrent}),{errorCode:'composition_authoring_conflict'});assert.equal(h.state.isCreating,false);assert.equal(h.writes.length,0);
  }
});
test('an occupied destination preserves exact generated and subsequently edited JSON for normal Save retry',async()=>{
  let attempts=0;const h=await fixture({write:()=>{if(++attempts===1)throw Error('occupied path');return{version:'saved'};}}),input=h.prepare();h.apply(input);
  h.source.value=h.source.value.replace('旅途','新旅途');h.runtime.refreshEditSessionDirtyState();const content=h.source.value;
  await h.runtime.saveCurrentDoc();assert.equal(h.state.isCreating,true);assert.equal(h.state.editHasUnsavedChanges,true);assert.equal(h.source.value,content);
  assert.match(h.element('docEditStatus').textContent,/occupied path/);h.element('docCreatePathInput').value='documents/compositions/retry.json';
  await h.runtime.saveCurrentDoc();assert.equal(h.writes.length,2);assert.equal(h.writes[1].content,content);assert.equal(h.writes[1].pathValue,'documents/compositions/retry.json');assert.equal(h.state.isCreating,false);
});
test('late focus receipts preserve caret and refuse to focus a different source session',async()=>{
  const h=await fixture(),receipt=h.apply(h.prepare());h.source.selectionStart=19;h.source.selectionEnd=23;h.source.scrollTop=77;
  h.runtime.document.querySelector=()=>({});assert.equal(receipt.focus(),false);h.runtime.document.querySelector=()=>null;
  assert.equal(receipt.focus(),true);assert.deepEqual([h.source.selectionStart,h.source.selectionEnd,h.source.scrollTop],[19,23,77]);assert.equal(receipt.focus(),false);
  const other=await fixture(),stale=other.apply(other.prepare());other.source.value+=' ';assert.equal(stale.focus(),false);
});

function multiInput(h) {
  const catalog=h.catalog(), single=h.request();
  catalog.existingPaths.push(`${catalog.documentRoot}/prop.md`);catalog.existingIdentities.push(id(4));
  catalog.objects.push({id:id(4),name:'Prop',sourcePath:`${catalog.documentRoot}/prop.md`,sourceRevision:rev('c'),canInheritProjection:false});
  const {actorKey,objectId,useProjectionDefaults,position,instanceId,...common}=single;
  const actors=[{actorKey,objectId,useProjectionDefaults,position,instanceId},
    {actorKey:'companion',objectId,useProjectionDefaults:true,position:[320,120],instanceId:id(5)},
    {actorKey:'prop',objectId:id(4),useProjectionDefaults:false,position:[480,120],instanceId:id(6)}];
  return {proposal:prepareCompositionDraft(h.context(),catalog,{...common,actors}),catalog};
}
for(const version of [2,3]) test(`multi-actor recipe enters one ordinary draft and one Save in workspace ${version}`,async()=>{
  const h=await fixture({version}),input=multiInput(h);assert.equal(h.apply(input).applied,true);
  const recipe=JSON.parse(h.source.value),actors=recipe.fragments[0].actors,mapping=recipe.placements[0].actorIds;
  assert.equal(actors.length,3);assert.equal(actors[0].objectId,actors[1].objectId);
  assert.deepEqual(mapping,{hero:id(3),companion:id(5),prop:id(6)});
  for(const actor of actors.slice(0,2)){assert.equal(actor.useProjectionDefaults,true);assert.equal(Object.hasOwn(actor,'size'),false);}
  assert.equal(actors[2].useProjectionDefaults,undefined);assert.equal(actors[2].controls,'arrows');
  assert.equal(h.writes.length,0);await h.runtime.saveCurrentDoc();assert.equal(h.writes.length,1);
  assert.equal(h.writes[0].content,input.proposal.content);assert.equal(h.writes[0].documentType,'note');assert.equal(h.writes[0].isCreate,true);
  assert.equal(h.state.editHasUnsavedChanges,false);
});
test('multi-actor failed Save retains every identity and field through destination retry',async()=>{
  let attempts=0;const h=await fixture({write:()=>{if(++attempts===1)throw Error('occupied multi path');return {version:'saved'};}}),input=multiInput(h);
  h.apply(input);const content=h.source.value;await h.runtime.saveCurrentDoc();
  assert.equal(h.source.value,content);assert.equal(h.state.isCreating,true);assert.equal(h.state.editHasUnsavedChanges,true);
  h.element('docCreatePathInput').value='documents/multi-retry.json';await h.runtime.saveCurrentDoc();
  assert.equal(h.writes.length,2);assert.equal(h.writes[1].pathValue,'documents/multi-retry.json');
  assert.equal(h.writes[0].content,content);assert.equal(h.writes[1].content,content);assert.equal(h.state.isCreating,false);
});

test('an explicitly arranged recipe saves once with every stable actor identity and inheritance declaration',async()=>{
  const h=await fixture(),seed=multiInput(h),before=seed.proposal.content;
  const arranged=planCompositionCreateLayout(seed.proposal.actors.map(({instanceId,position})=>({instanceId,position})),
    {mode:'grid',origin:[40,80],spacing:[100,150],columns:2});
  const request=Object.fromEntries(['documentType','sourcePath','title','fragmentId','viewport','background','placementId'].map(key=>[key,seed.proposal[key]]));
  request.actors=seed.proposal.actors.map((actor,index)=>({...actor,position:arranged.positions[index].position}));
  const proposal=prepareCompositionDraft(h.context(),seed.catalog,request);assert.equal(seed.proposal.content,before);
  assert.equal(h.apply({proposal,catalog:seed.catalog}).applied,true);assert.equal(h.writes.length,0);
  const source=JSON.parse(h.source.value);assert.deepEqual(source.fragments[0].actors.map(a=>a.position),[[40,80],[140,80],[40,230]]);
  assert.deepEqual(source.placements,JSON.parse(before).placements);
  for(let index=0;index<3;index++){
    const {position,...actor}=source.fragments[0].actors[index];const {position:oldPosition,...original}=JSON.parse(before).fragments[0].actors[index];
    assert.deepEqual(actor,original);
  }
  await h.runtime.saveCurrentDoc();assert.equal(h.writes.length,1);assert.equal(h.writes[0].content,proposal.content);assert.equal(h.state.editHasUnsavedChanges,false);
});
