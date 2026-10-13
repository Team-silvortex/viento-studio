// Read-only acceptance of standard prepare outputs. Writes only its evidence JSON.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url)), evidence=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=relative=>fs.readFile(path.join(root,relative));
const clone=value=>JSON.parse(JSON.stringify(value));
const strip=source=>source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm,'').replace(/^export /gm,'');
const common=['engine/scene-composition-create-layout.mjs','engine/scene-composition-create.mjs','engine/scene-composition.mjs','engine/studio-core.mjs','engine/studio-core.wasm','engine/document-contract.mjs','engine/canonical-json.mjs','engine/studio-modules.mjs',
 'web/modules/app-scene-composition-create.js','web/scene-composition-create.css','web/modules/app-runtime.js','web/modules/app-project-build.js','web/modules/app-studio-system.js','web/modules/app-studio-core.js','web/i18n/en.js','web/i18n/ja.js','web/i18n/index.js'];
const services=['scripts/lib/scene-composition-create-service.mjs','scripts/lib/doc-api-service.mjs','scripts/lib/doc-server-routes.mjs'];
const output={checkedAt:new Date().toISOString(),ok:false,scope:'Standard desktop/resources and mobile/dist prepared files; this does not rebuild, install, launch an AppImage/APK, or call real mobile/native storage.',copies:[],executions:[],gates:[],limitations:[
 'Hash checks cover the explicit feature files below, not every bundled dependency or a newly assembled release artifact.',
 'The pure creation and initial-layout planners execute from each prepared copy with its copied WASM in Node. It receives synthetic in-memory creation metadata; no World service, filesystem writer or project is called.',
 'Mobile capability and prepared GUI gate execute in a VM with an in-memory context response and minimal DOM. This checks dispatch/visibility logic, not native Android layout, network, IPC or real device execution.',
]};
const same=async(source,prepared)=>{const [a,b]=await Promise.all([read(source),read(prepared)]);assert.deepEqual(b,a,prepared);output.copies.push({source,prepared,bytes:b.length,sha256:hash(b)});};
async function filesBelow(relative){const rows=await fs.readdir(path.join(root,relative),{recursive:true,withFileTypes:true});return rows.filter(row=>row.isFile()).map(row=>path.relative(path.join(root,relative),path.join(row.parentPath||row.path,row.name))).sort();}
const load=(prefix,relative)=>import(pathToFileURL(path.join(root,prefix,relative)).href);
function documentFixture(){
 const byId=new Map();const make=()=>({id:'',open:false,hidden:false,disabled:false,children:[],value:'',checked:false,style:{},dataset:{},append(...items){this.children.push(...items);for(const item of items){item.parentElement=this;if(item.id)byId.set(item.id,item);}},setAttribute(key,value){this[key]=value;},addEventListener(){},querySelector(selector){const id=selector.slice(1);if(!byId.has(id))byId.set(id,{...make(),id});return byId.get(id);},close(){this.open=false;},remove(){},focus(){}});
 const document={createElement:make,getElementById:id=>byId.get(id)||null};document.head=make();document.body=make();const actions=make();actions.id='docEditActions';byId.set(actions.id,actions);return{document,byId};
}
async function gate(prefix,mobilePayload){
 const registry=await load(prefix,'engine/studio-modules.mjs'),planner=await load(prefix,'engine/scene-composition-create.mjs'),layout=await load(prefix,'engine/scene-composition-create-layout.mjs');
 const {document,byId}=documentFixture();const bindings={document,crypto:{randomUUID},planCompositionCreateLayout:layout.planCompositionCreateLayout,AbortController,console,t:key=>key,translatePage(){},onLanguageChange:()=>()=>{},
 SCENE_COMPOSITION_CREATE_API_PATH:planner.SCENE_COMPOSITION_CREATE_API_PATH,SCENE_COMPOSITION_CREATE_MAX_ACTORS:planner.SCENE_COMPOSITION_CREATE_MAX_ACTORS,validateCompositionCreateCatalog:planner.validateCompositionCreateCatalog,prepareCompositionDraft:planner.prepareCompositionDraft,prepareCompositionDraftApply:planner.prepareCompositionDraftApply,
 fetchJsonApiRequest:()=>{throw Error('Visibility gate must not fetch');},createStudioModuleRegistry:()=>({plan:(profile,options)=>registry.createStudioModuleRegistry().plan(clone(profile),clone(options))}),setupSettings:async()=>{}};
 for(const name of ['setupWorldBrowser','setupProjectBuild','setupProjectSettings','setupExport','setupMediaEditor'])bindings[name]=()=>({setAvailable(){}});
 const context=vm.createContext(bindings);vm.runInContext(strip((await read(`${prefix}/web/modules/app-scene-composition-create.js`)).toString()),context);
 vm.runInContext(strip((await read(`${prefix}/web/modules/app-studio-system.js`)).toString()),context);
 const system=await context.setupStudioSystem({ports:{compositionCreate:{getContext:()=>({editable:true,busy:false,dirty:false,creating:false,sourceToken:'prepared-copy',documentRoot:'documents',documentTypes:[{id:'document',label:'Document'}]})}}});
 const button=byId.get('sceneCompositionCreateBtn');assert.ok(button);assert.equal(button.hidden,true);
 const cases=[];for(const [name,payload,hidden]of[['mobile-native-payload',mobilePayload,true],['project-build-without-semantic-query',{semanticProjection:false,projectBuild:true},true],['non-boolean-query-capability',{semanticProjection:'true'},true],['semantic-query-without-build-or-command',{semanticProjection:true,projectBuild:false,semanticCommands:[]},false]]){system.updateCapabilities(payload);assert.equal(button.hidden,hidden,name);cases.push({name,hidden});}
 system.updateCapabilities(mobilePayload);system.updateProject({studioProfile:{format:'viento-studio-profile',schemaVersion:1,required:[{capability:'scene.authoring.composition-create',apiVersion:1}],optional:[]}});assert.equal(button.hidden,true);
 cases.push({name:'project-request-cannot-grant-missing-host-query',hidden:true});return{copy:prefix,cases,actualCopiedControllerAndCompositionRoot:true,networkCalls:0};
}
try{
 for(const prefix of ['desktop/resources','mobile/dist'])for(const source of common)await same(source,`${prefix}/${source}`);
 for(const source of services)await same(source,`desktop/resources/${source}`);
 for(const name of ['en.js','ja.js','index.js'])await same(`web/i18n/${name}`,`desktop/ui/i18n/${name}`);
 await same('mobile/platform.mjs','mobile/dist/mobile/platform.mjs');
 const mobileFiles=await filesBelow('mobile/dist'),desktopFiles=await filesBelow('desktop/resources');
 const mobileScripts=mobileFiles.filter(name=>name.startsWith('scripts/'));
 assert.deepEqual(mobileScripts,['scripts/lib/doc-api-contract.mjs','scripts/lib/document-values.mjs','scripts/lib/media-format.mjs']);
 for(const name of services)assert.equal(mobileFiles.includes(name),false);
 assert.equal(mobileFiles.some(name=>name.startsWith('node_modules/')||name.startsWith('binaries/')||name.startsWith('scripts/adapters/')),false);
 const nodeImports=[];for(const name of mobileFiles.filter(name=>/\.(?:mjs|js)$/.test(name))){const source=(await read(`mobile/dist/${name}`)).toString();if(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]node:/.test(source))nodeImports.push(name);}
 assert.deepEqual(nodeImports,[]);output.mobileIsolation={totalFiles:mobileFiles.length,scripts:mobileScripts,nodeServiceFiles:0,nodeBuiltinImportFiles:nodeImports,hasNodeModulesOrBinaryDirectory:false};output.desktopPreparedFileCount=desktopFiles.length;
 for(const prefix of ['desktop/resources','mobile/dist']){
  const core=await load(prefix,'engine/studio-core.mjs'),planner=await load(prefix,'engine/scene-composition-create.mjs');
  const coreState=await core.initializeStudioCore(()=>read(`${prefix}/engine/studio-core.wasm`));assert.equal(coreState.ready,true);
  const editor={sourceToken:'prepared-copy',documentRoot:'documents',documentTypes:[{id:'document',label:'Document'}]},objectId='10000000-0000-4000-8000-000000000001',ordinaryId='10000000-0000-4000-8000-000000000002';
  const catalog={format:'viento-scene-composition-create-context',schemaVersion:1,worldId:'prepared-copy',worldRevision:'sha256:'+'a'.repeat(64),documentRoot:editor.documentRoot,documentTypes:editor.documentTypes,existingPaths:['documents/player.json','documents/ordinary.md'],existingIdentities:[objectId,ordinaryId],objects:[{id:objectId,name:'Player',sourcePath:'documents/player.json',sourceRevision:'sha256:'+'b'.repeat(64),canInheritProjection:true},{id:ordinaryId,name:'Ordinary character',sourcePath:'documents/ordinary.md',sourceRevision:'sha256:'+'d'.repeat(64),canInheritProjection:false}]};
  const request={documentType:'document',sourcePath:'documents/scenes/new-composition.json',title:'Prepared copy',fragmentId:'main',actorKey:'actor',objectId,useProjectionDefaults:true,position:[140,180],viewport:[960,540],background:'#142233',placementId:'20000000-0000-4000-8000-000000000001',instanceId:'30000000-0000-4000-8000-000000000001'};
  const proposal=planner.prepareCompositionDraft(editor,catalog,request),prepared=planner.prepareCompositionDraftApply(editor,catalog,proposal),actor=JSON.parse(prepared.content).fragments[0].actors[0];
  assert.deepEqual(actor,{key:'actor',objectId,position:[140,180],useProjectionDefaults:true});assert.equal(prepared.content,proposal.content);
  assert.throws(()=>planner.prepareCompositionDraftApply(editor,{...catalog,worldRevision:'sha256:'+'c'.repeat(64)},proposal),{errorCode:'composition_authoring_conflict'});
  assert.equal(planner.SCENE_COMPOSITION_CREATE_MAX_ACTORS,64);
  const {actorKey,objectId:legacyObjectId,useProjectionDefaults,position,instanceId,...commonRequest}=request;
  const multiRequest={...commonRequest,actors:[{actorKey:'projected',objectId:legacyObjectId,useProjectionDefaults,position,instanceId},
   {actorKey:'ordinary',objectId:ordinaryId,useProjectionDefaults:false,position:[420,180],instanceId:'30000000-0000-4000-8000-000000000002'},
   {actorKey:'same_source',objectId:legacyObjectId,useProjectionDefaults:false,position:[640,180],instanceId:'30000000-0000-4000-8000-000000000003'}]};
  const multiProposal=planner.prepareCompositionDraft(editor,catalog,multiRequest),multiPrepared=planner.prepareCompositionDraftApply(editor,catalog,multiProposal);
  const composition=JSON.parse(multiPrepared.content),multiActors=composition.fragments[0].actors;
  assert.equal(composition.schemaVersion,1);assert.equal(composition.fragments.length,1);assert.equal(composition.placements.length,1);assert.equal(multiActors.length,3);
  assert.deepEqual(multiActors[0],{key:'projected',objectId,position:[140,180],useProjectionDefaults:true});
  for(const index of [1,2]){assert.equal(Object.hasOwn(multiActors[index],'useProjectionDefaults'),false);assert.deepEqual(multiActors[index].size,[64,64]);assert.equal(multiActors[index].speed,160);}
  assert.deepEqual(composition.placements[0].actorIds,Object.fromEntries(multiRequest.actors.map(actor=>[actor.actorKey,actor.instanceId])));
  assert.equal(multiActors[0].objectId,multiActors[2].objectId);assert.notEqual(multiRequest.actors[0].instanceId,multiRequest.actors[2].instanceId);
  const expansion=await load(prefix,'engine/scene-composition.mjs'),expanded=expansion.expandSceneComposition(multiPrepared.content);
  assert.equal(expanded.scene.schemaVersion,3);assert.equal(expanded.scene.actors.length,3);
  assert.deepEqual(expanded.scene.actors.map(actor=>actor.instanceId),multiRequest.actors.map(actor=>actor.instanceId));
  const duplicate=clone(multiRequest);duplicate.actors[2].instanceId=duplicate.actors[0].instanceId;
  assert.throws(()=>planner.prepareCompositionDraft(editor,catalog,duplicate),{errorCode:'composition_authoring_invalid'});
  assert.throws(()=>planner.prepareCompositionDraftApply(editor,{...catalog,worldRevision:'sha256:'+'c'.repeat(64)},multiProposal),{errorCode:'composition_authoring_conflict'});
  assert.equal(multiPrepared.content,multiProposal.content);assert.deepEqual(multiProposal.actors,multiRequest.actors);
  const layout=await load(prefix,'engine/scene-composition-create-layout.mjs');
  const layoutActors=multiRequest.actors.map(({instanceId,position})=>({instanceId,position:[...position]})),layoutBefore=clone(layoutActors);
  const expectedLayouts={row:[[20,30],[60,30],[100,30]],column:[[20,30],[20,80],[20,130]],grid:[[20,30],[60,30],[20,80]]},layouts=[];
  for(const mode of ['row','column','grid']){
   const result=layout.planCompositionCreateLayout(layoutActors,{mode,origin:[20,30],spacing:[40,50],columns:2});
   assert.deepEqual(result.positions.map(actor=>actor.instanceId),layoutActors.map(actor=>actor.instanceId));
   assert.deepEqual(result.positions.map(actor=>actor.position),expectedLayouts[mode]);assert.equal(result.changedCount,3);
   assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.positions));assert.ok(result.positions.every(actor=>Object.isFrozen(actor)&&Object.isFrozen(actor.position)));
   layouts.push({mode,changedCount:result.changedCount,positions:result.positions});
  }
  assert.deepEqual(layoutActors,layoutBefore);
  assert.throws(()=>layout.planCompositionCreateLayout(layoutActors,{mode:'row',origin:[99999,0],spacing:[1,1],columns:2}),{errorCode:'composition_layout_invalid'});
  const placedRequest=clone(multiRequest);placedRequest.actors.forEach((actor,index)=>{actor.position=layouts[2].positions[index].position;});
  const placedProposal=planner.prepareCompositionDraft(editor,catalog,placedRequest),placed=planner.prepareCompositionDraftApply(editor,catalog,placedProposal);
  assert.deepEqual(JSON.parse(placed.content).fragments[0].actors.map(actor=>actor.position),expectedLayouts.grid);
  output.executions.push({copy:prefix,core:coreState,legacySinglePreparedAndApplied:true,legacyContentSha256:hash(prepared.content),multiPreparedAndApplied:true,actorCount:3,
   mixedProjectionInheritanceUnflattened:true,sameSourceDistinctInstanceIds:true,duplicateInstanceIdRejected:true,changedWorldRejected:true,
   recipeSchemaVersion:composition.schemaVersion,expandedSceneSchemaVersion:expanded.scene.schemaVersion,maxAssistantActors:planner.SCENE_COMPOSITION_CREATE_MAX_ACTORS,
   contentSha256:hash(multiPrepared.content),layouts,layoutInputUnchanged:true,layoutOverflowRejected:true,layoutAppliedToOrdinaryRecipe:true,layoutRecipeSha256:hash(placed.content),persistenceCalls:0});
 }
 const prefix='mobile/dist',contract=await load(prefix,'engine/document-contract.mjs'),project=await load(prefix,'engine/project.mjs'),store=await load(prefix,'engine/document-store.mjs');
 const context=vm.createContext({createProjectModel:project.createProjectModel,createDocumentStore:store.createDocumentStore,makeCapabilitiesPayload:contract.makeCapabilitiesPayload,API_PATHS:contract.API_PATHS,Response,URL,TextEncoder});
 vm.runInContext(strip((await read(`${prefix}/mobile/platform.mjs`)).toString()),context);
 const nativeCalls=[],platform=context.createMobilePlatform({workspaceId:'memory-only',invoke:async(command,request)=>{nativeCalls.push({command,action:request.action});assert.equal(command,'mobile_storage');assert.equal(request.action,'context');return{manifest:{version:3},documents:[],defaults:{paths:{documents:'documents',templates:'templates',metadata:'metadata'},documentTypes:[],templates:{}}};}});
 const response=await platform.request('/api/capabilities');assert.equal(response.status,200);const payload=await response.json();assert.notEqual(payload.semanticProjection,true);assert.equal(payload.projectBuild,false);
 const rejected=await platform.request('/api/scene-composition-create');assert.equal(rejected.status,501);
 output.mobileCapability={copiedPlatformExecuted:true,capabilities:payload,compositionCatalogStatus:rejected.status,nativeCalls,allStorageCallsAreInMemoryContextReads:true};
 for(const prefix of ['desktop/resources','mobile/dist'])output.gates.push(await gate(prefix,payload));
 output.counts={commonFeatureSourceFiles:common.length,commonCopyComparisons:common.length*2,desktopServiceCopies:services.length,desktopLibraryTranslationCopies:3,mobilePlatformCopies:1,totalExactByteComparisons:output.copies.length,purePlannerPreparedCopyRuns:output.executions.length,pureLayoutModeRuns:output.executions.reduce((sum,item)=>sum+item.layouts.length,0),actualCopiedUiGateCases:output.gates.reduce((sum,item)=>sum+item.cases.length,0)};
 output.prepareLogs=await Promise.all(['desktop-prepare.log','mobile-prepare.log'].map(async name=>{const bytes=await fs.readFile(path.join(evidence,name));return{path:name,sha256:hash(bytes),content:bytes.toString()};}));
 output.verifierSha256=hash(await fs.readFile(fileURLToPath(import.meta.url)));output.ok=true;
}catch(error){output.failure=error.stack;process.exitCode=1;}finally{output.finishedAt=new Date().toISOString();await fs.writeFile(path.join(evidence,'packaged-resources.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({ok:output.ok,counts:output.counts,failure:output.failure},null,2));}
