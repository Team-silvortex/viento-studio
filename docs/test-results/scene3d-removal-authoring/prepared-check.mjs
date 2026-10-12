import { runRemovalCases } from './portable-removal-cases.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = path.dirname(fileURLToPath(import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const fileSha = async file => sha(await fs.readFile(file));
const json = value => JSON.stringify(value, null, 2) + '\n';
const rewrite = source => source.replaceAll("from 'yaml'", "from '/vendor/yaml/index.js'")
  .replaceAll("from '../node_modules/yaml/browser/index.js'", "from '/vendor/yaml/index.js'");
const nodeSha = '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c';
assert.equal(process.version, 'v24.21.0'); assert.equal(await fileSha(process.execPath), nodeSha);
const report = { startedAt: new Date().toISOString(), schemaVersion: 1,
  scope: 'Actual prepared desktop/mobile inventories, independent Rust-backed atomic CST batch removal and batch copy with explicit new UUIDs/common offset and independent Rust-backed sorted fixed-endpoint distribution and independent Rust-backed world-axis alignment to an explicit selected reference and independent Rust-backed atomic multi-object translation source proposals and copied renderer selection feedback over injected fake canvas/WebGL ports (not GPU shader or pixel execution), readonly 3D geometric picking over Float32-quantized drawing-frame fixtures plus readonly 3D object indexing and exact UTF16/source-display navigation plus independent 3D name/color properties and author camera/light/background plus add/copy/remove and transform proposals plus the prior primitive/authoring/system/workflow/scene contract checks. Standard VM portability only, not installation or Android device acceptance.',
  vmScope: 'Standard VM context exposes WebAssembly and text codecs only, without Node/DOM/fetch/process globals. Harness ports supply JSON DTOs and deterministic SHA; this proves copied module portability, not a hostile-code sandbox or device acceptance.',
  embeddedNode: { version: process.version, sha256: nodeSha }, proofSourceSha256: await fileSha(fileURLToPath(import.meta.url)),
  artifacts: {}, portable: {}, sourceHashes: {} };
report.version = (await fs.readFile(path.join(root, 'VERSION'), 'utf8')).trim();
assert.match(report.version, /^\d+\.\d+\.\d+$/);

async function inventory(directory, filter = () => true) {
  const entries = {};
  async function visit(relative) {
    const location = path.join(directory, relative);
    for (const entry of await fs.readdir(location, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!filter(name, entry)) continue;
      if (entry.isDirectory()) await visit(name);
      else {
        assert.ok(entry.isFile(), `Only regular files may enter inventory: ${directory}/${name}`);
        const bytes = await fs.readFile(path.join(directory, name));
        const signature = bytes.length >= 4 ? bytes.readUInt32BE(0) : null;
        const native = [0x7f454c46,0xcafebabe,0xfeedface,0xcefaedfe,0xfeedfacf,0xcffaedfe].includes(signature)
          || bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
        entries[name] = { bytes: bytes.length, sha256: sha(bytes), ...(native ? { nativeExecutable: true } : {}) };
      }
    }
  }
  await visit(''); return Object.fromEntries(Object.entries(entries).sort(([a],[b]) => a.localeCompare(b,'en')));
}
const frozenSource = JSON.parse(await fs.readFile(path.join(evidence,'source-hashes-final.json')));
for (const [file,digest] of Object.entries(frozenSource)) assert.equal(await fileSha(path.join(root,file)),digest,`Frozen source changed: ${file}`);
report.frozenSource = {files:Object.keys(frozenSource).length,manifestSha256:await fileSha(path.join(evidence,'source-hashes-final.json')),allMatch:true};
const source = async relative => {
  const bytes = await fs.readFile(path.join(root, relative));
  if (Object.hasOwn(report.sourceHashes, relative)) assert.equal(report.sourceHashes[relative], sha(bytes), `Source changed while mapping: ${relative}`);
  report.sourceHashes[relative] = sha(bytes); return bytes;
};
async function expectedTree(prefix, filter = () => true, transform = null) {
  const files = await inventory(path.join(root,prefix), filter), out = {};
  for (const name of Object.keys(files)) {
    const origin = `${prefix}/${name}`, bytes = await source(origin), expected = transform ? transform(origin, bytes) : bytes;
    out[origin] = { source: origin, sourceSha256: sha(bytes), expectedSha256: sha(expected), transformation: bytes.equals(expected) ? null : 'local YAML import rewrite' };
  }
  return out;
}
const desktopExpected = {}, mobileExpected = {};
for (const prefix of ['engine','scripts','web','schemas']) Object.assign(desktopExpected, await expectedTree(prefix,
  (name, entry) => !entry.name.startsWith('.') && !(prefix === 'scripts' && name === 'tests') && !(prefix === 'web' && name === 'data')));
const lock = JSON.parse(await source('package-lock.json'));
for (const [relative, dependency] of Object.entries(lock.packages)) if (relative.startsWith('node_modules/') && !dependency.dev) {
  assert.equal(dependency.link, undefined); assert.ok(!relative.split('/').includes('..'));
  Object.assign(desktopExpected, await expectedTree(relative));
}
async function mapped(out, name, origin, transform = value => value, label = null) {
  const bytes = await source(origin), expected = transform(bytes);
  out[name] = { source: origin, sourceSha256: sha(bytes), expectedSha256: sha(expected), transformation: label };
}
await mapped(desktopExpected, 'VERSION', 'VERSION'); await mapped(desktopExpected, 'favicon.ico', 'favicon.ico');
await mapped(desktopExpected, 'package.json', 'VERSION', () => Buffer.from(JSON.stringify({ private:true,type:'module',version:report.version,displayVersion:report.version })), 'generated package metadata');
const runtime = JSON.parse(await source('desktop/node-runtime.json'));
await mapped(desktopExpected, 'NODE-LICENSE', `desktop/.cache/${runtime.version}-LICENSE`);
assert.equal(desktopExpected['NODE-LICENSE'].expectedSha256, runtime.licenseSha256);
for (const prefix of ['engine','web']) Object.assign(mobileExpected, await expectedTree(prefix,
  (name, entry) => !entry.name.startsWith('.') && !(prefix === 'web' && name === 'data') && !name.endsWith('.md'),
  (origin, bytes) => origin.startsWith('engine/') && origin.endsWith('.mjs') ? Buffer.from(rewrite(bytes.toString())) : bytes));
for (const name of Object.keys(await inventory(path.join(root,'node_modules/yaml/browser')))) await mapped(mobileExpected,`vendor/yaml/${name}`,`node_modules/yaml/browser/${name}`);
await mapped(mobileExpected,'vendor/yaml/LICENSE','node_modules/yaml/LICENSE');
for (const name of ['doc-api-contract.mjs','media-format.mjs','document-values.mjs']) await mapped(mobileExpected,`scripts/lib/${name}`,`scripts/lib/${name}`);
for (const name of ['platform.mjs','library.js','editor.js','drafts.mjs','mobile.css']) await mapped(mobileExpected,`mobile/${name}`,`mobile/${name}`);
await mapped(mobileExpected,'index.html','mobile/index.html', bytes => Buffer.from(bytes.toString().replaceAll('__VIENTO_VERSION__',report.version)), 'release version substitution');
await mapped(mobileExpected,'editor.html','web/index.html', bytes => Buffer.from(bytes.toString().replace(/<title>.*?<\/title>/,'<title>Viento Studio</title>')
  .replace('</head>','<link rel="stylesheet" href="/mobile/mobile.css" /></head>').replace('<body>','<body class="mobile-host">')
  .replace('<script type="module" src="/web/app.js"></script>','<script type="module" src="/mobile/editor.js"></script>')
  .replace('<script type="module" src="/web/modules/desktop-bridge.js"></script>','')), 'mobile shell entry');
await mapped(mobileExpected,'favicon.ico','favicon.ico');
for (const [name,expected] of [['desktop/resources',desktopExpected],['mobile/dist',mobileExpected]]) {
  const actual = await inventory(path.join(root,name));
  assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),`Prepared files missing or extra: ${name}`);
  for (const [file,value] of Object.entries(actual)) assert.equal(value.sha256,expected[file].expectedSha256,`Prepared byte mismatch: ${name}/${file}`);
  assert.ok(!Object.values(actual).some(value => value.nativeExecutable));
  assert.ok(!Object.keys(actual).some(file => /^(?:examples|works|workspaces|crates)\//.test(file) || file.startsWith('web/data/') || file.startsWith('scripts/tests/')));
  if (name === 'mobile/dist') assert.ok(!Object.keys(actual).some(file => file.startsWith('scripts/adapters/') || file.startsWith('scripts/backends/') || file === 'scripts/lib/project-build-service.mjs' || file.startsWith('node_modules/')));
  report.artifacts[name] = { manifestFileCount:Object.keys(actual).length, manifestBytes:Object.values(actual).reduce((sum,item)=>sum+item.bytes,0), manifestSha256:sha(JSON.stringify(actual)),
    manifest:actual,fullSourceCopyCount:Object.keys(expected).length,fullSourceCopySha256:sha(JSON.stringify(expected)),fullSourceCopies:expected };
}
{
  const actual = await inventory(path.join(root,'desktop/ui')), expected = {};
  assert.deepEqual(Object.keys(actual).filter(name=>name.startsWith('i18n/')).sort(),Object.keys(await inventory(path.join(root,'web/i18n'))).map(name=>`i18n/${name}`).sort());
  for (const [file,value] of Object.entries(actual)) {
    const origin = file.startsWith('i18n/') ? `web/${file}` : `desktop/ui/${file}`;
    await mapped(expected,file,origin); assert.equal(value.sha256,expected[file].expectedSha256);
  }
  report.artifacts['desktop/ui'] = { manifestFileCount:Object.keys(actual).length,manifestBytes:Object.values(actual).reduce((sum,item)=>sum+item.bytes,0),manifestSha256:sha(JSON.stringify(actual)),
    manifest:actual,fullSourceCopyCount:Object.keys(expected).length,fullSourceCopySha256:sha(JSON.stringify(expected)),fullSourceCopies:expected };
}
const historical = JSON.parse(await fs.readFile(path.join(evidence,'historical-baseline.json')));
for (const [file,digest] of Object.entries(historical)) assert.equal(await fileSha(path.join(root,file)),digest,`Historical report changed: ${file}`);
report.historicalPreservation = { files:Object.keys(historical).length,sha256:await fileSha(path.join(evidence,'historical-baseline.json')),allMatch:true };
const previous = JSON.parse(await fs.readFile(path.join(evidence,'source-baseline.json')));
report.previousSourceManifest = { files:Object.keys(previous).length,sha256:await fileSha(path.join(evidence,'source-baseline.json')),
  scope:'Previous source manifest is immutable evidence; current equality is checked against the actual frozen copies above, including readonly navigation source/UI wiring.' };

const example = JSON.parse(await fs.readFile(path.join(root,'examples/scene-composition/recipe.json')));
const { fixture, copy, revision } = await import('../scene-composition-placement-offset/boundary-cases.mjs');
const { runPlacementCases } = await import('../scene-composition-placement-offset/boundary-cases.mjs');
const { runInheritanceCases } = await import('../scene-composition-fragment-inheritance/boundary-cases.mjs');
const { runPlacementsCases } = await import('../scene-composition-placement-structure/boundary-cases.mjs');
const { runGroupsCases } = await import('../scene-composition-group-authoring/boundary-cases.mjs');
const { runDefinitionsCases } = await import('../scene-composition-definition-authoring/boundary-cases.mjs');
const { runDefinitionRenameCases } = await import('../scene-composition-fragment-rename/boundary-cases.mjs');
const { runScene3DCases } = await import('../scene3d-primitives/boundary-cases.mjs');
const { runAlignmentCases } = await import('../scene3d-alignment-authoring/boundary-cases.mjs');
const { runDistributionCases } = await import('../scene3d-distribution-authoring/boundary-cases.mjs');
const { runCopyCases } = await import('../scene3d-copy-authoring/boundary-cases.mjs');
const moduleFiles = ['engine/scene3d-copy.mjs','engine/scene3d-removal.mjs','engine/scene3d-distribution.mjs','engine/scene3d-alignment.mjs','engine/scene3d-translation.mjs','web/modules/scene3d-renderer.js','web/modules/scene3d-picking.js','web/modules/scene3d-math.js','engine/scene3d-navigation.mjs','engine/scene3d-properties.mjs','engine/scene3d-environment.mjs','engine/scene3d-objects.mjs','engine/scene3d-transform.mjs','engine/scene3d.mjs', 'engine/scene-composition-definitions.mjs', 'engine/scene-composition-groups.mjs', 'engine/scene-composition-placements.mjs', 'engine/studio-modules.mjs', 'engine/project.mjs', 'engine/scene-authoring-workflow.mjs','engine/scene-authoring-candidate.mjs','engine/scene-composition-structure.mjs','engine/scene-composition-placement.mjs','engine/scene-composition-fragments.mjs',
  'engine/scene-composition.mjs','engine/scene-structure.mjs','engine/studio-core.mjs','engine/json-source.mjs'];
async function cases(api) {
  assert.equal(api.supportsStudioCoreCompositionStructure(),true);
  const checks = [], parse = text => JSON.parse(text.replace(/^\uFEFF/,''));
  const actor = { key:'newActor',objectId:example.fragments[0].actors[0].objectId,groupKey:'companions',position:[240.5,100.25],size:[32,32],color:'#aabbcc',speed:0,controls:'none' };
  const edit = {action:'add',fragmentId:'party',actor,instances:example.placements.map((p,i)=>({placementId:p.placementId,instanceId:`9000000${i}-1111-4111-8111-111111111111`}))};
  for(const dirty of [false,true]) {
    const f=fixture(api,example,dirty), before=copy(f), draft=await api.createSceneCompositionStructureDraft(f.model,f.source,{digest:sha});
    const p=copy(draft.propose(copy(edit)));
    assert.deepEqual(copy(await api.prepareSceneCompositionStructureApply(f.source,p,{digest:sha})),{afterContent:p.afterContent,changedPaths:p.changedPaths});
    const expanded=copy(api.expandSceneComposition(p.afterContent)); assert.equal(expanded.scene.actors.length,6);
    assert.deepEqual(expanded.scene.actors.filter(a=>a.instanceId.startsWith('9000000')).map(a=>a.position),[[240.5,100.25],[600.5,180.25]]);
    const after=parse(p.afterContent);assert.deepEqual(after.fragments[0].actors.slice(0,2),example.fragments[0].actors);
    for(const [i,placement]of after.placements.entries()) {
      assert.deepEqual(placement.groupIds,example.placements[i].groupIds); assert.deepEqual(placement.overrides,example.placements[i].overrides);
    }
    assert.equal(p.afterContent.startsWith('\uFEFF'),true); assert.equal(p.afterContent.includes('\r\n'),true); assert.deepEqual(f,before);
    const added=fixture(api,p.afterContent),remove=copy((await api.createSceneCompositionStructureDraft(added.model,added.source,{digest:sha})).propose({action:'remove',fragmentId:'party',actorKey:'newActor'}));
    await api.prepareSceneCompositionStructureApply(added.source,remove,{digest:sha});assert.deepEqual(parse(remove.afterContent),example);
  }
  checks.push({id:'saved-and-dirty-add-remove-stable-identities-full-source-receipts',ok:true,modes:2});
  {
    const f=fixture(api,example), draft=await api.createSceneCompositionStructureDraft(f.model,f.source,{digest:sha});
    const p=copy(draft.propose({action:'remove',fragmentId:'party',actorKey:'leader'}));
    assert.deepEqual(p.targets[1].overrides,['position','color','speed','controls']);
    const after=parse(p.afterContent); assert.deepEqual(after.placements[1].overrides,[]);
    assert.deepEqual(after.fragments[0].groups,example.fragments[0].groups);await api.prepareSceneCompositionStructureApply(f.source,p,{digest:sha});
    checks.push({id:'remove-all-instances-and-owned-overrides-preserves-groups-and-empty-array',ok:true});
  }
  {
    const value=copy(example), alone=copy(actor);delete alone.groupKey;value.fragments.push({fragmentId:'unused',groups:[],actors:[{...alone,key:'alone'}]});
    const f=fixture(api,value),d=await api.createSceneCompositionStructureDraft(f.model,f.source,{digest:sha});
    const p=copy(d.propose({action:'add',fragmentId:'unused',actor:alone,instances:[]}));assert.deepEqual(p.targets,[]);
    assert.deepEqual(copy(api.expandSceneComposition(p.afterContent).scene),copy(api.expandSceneComposition(f.source.content).scene));
    await api.prepareSceneCompositionStructureApply(f.source,p,{digest:sha});
    assert.throws(()=>d.propose({action:'remove',fragmentId:'unused',actorKey:'alone'}));
    checks.push({id:'unused-fragment-with-empty-mapping-and-last-member-guard',ok:true});
  }
  {
    const f=fixture(api,example),d=await api.createSceneCompositionStructureDraft(f.model,f.source,{digest:sha});
    for(const mutate of [e=>{e.instances.pop();},e=>{e.instances.reverse();},e=>{e.instances[0].instanceId=f.model.scene.objectId;},
      e=>{e.instances[0].instanceId=example.placements[0].placementId;},e=>{e.instances[0].instanceId=example.placements[0].groupIds.party;},
      e=>{e.actor.groupKey='absent';},e=>{e.actor.position=[100000,0];},e=>{e.actor.key='leader';}]) {
      const input=copy(edit);mutate(input);assert.throws(()=>d.propose(input));
    }
    const p=copy(d.propose(edit));
    for(const mutate of [v=>{v.targets.reverse();},v=>{v.afterContent+=' ';},v=>{v.changedPaths=[];},v=>{v.edit.instances[0].instanceId=f.model.scene.objectId;}]) {
      const bad=copy(p);mutate(bad);await assert.rejects(api.prepareSceneCompositionStructureApply(f.source,bad,{digest:sha}));
    }
    await assert.rejects(api.prepareSceneCompositionStructureApply({...f.source,content:f.source.content+' '},p,{digest:sha}));
    checks.push({id:'missing-reordered-colliding-mappings-offset-bounds-and-tampered-receipts-rejected',ok:true,rejectedOperations:13});
  }
  return checks;
}

async function workflowCases(api) {
  const checks=[],domains=[['Override','instance'],['Layout','instance'],['BatchLayout','positions'],['Fragment','fragment'],['Placement','placement'],['Structure','structure'],['Placements','placements'],['Groups','groups'],['Definitions','definitions']];
  const f=fixture(api,example), previewId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const groupDraft=await api.createSceneCompositionGroupsDraft(f.model,f.source,{digest:sha});
  const groupProposal=copy(groupDraft.propose({action:'edit',fragmentId:'party',groupKey:'party',name:'Reviewed group',parentKey:null}));
  const placementDraft=await api.createSceneCompositionPlacementsDraft(f.model,f.source,{digest:sha});
  const placementProposal=copy(placementDraft.propose({action:'remove',placementId:example.placements[1].placementId}));
  const definitionDraft=await api.createSceneCompositionDefinitionsDraft(f.model,f.source,{digest:sha});
  const definitionProposal=copy(definitionDraft.propose({action:'copy',sourceFragmentId:'party',fragmentId:'prepared_copy'}));
  function proposal(kind) {
    if(kind==='definitions')return api.realmJson(JSON.stringify(definitionProposal));
    if(kind==='groups')return api.realmJson(JSON.stringify(groupProposal));
    if(kind==='placements')return api.realmJson(JSON.stringify(placementProposal));
    const first=example.placements[0],second=example.placements[1],value={sceneId:f.model.scene.objectId,sourcePath:f.source.sourcePath,baseSourceRevision:f.source.baseSourceRevision,
      sourceRevision:f.model.composition.sourceRevision,afterContent:f.source.content,changedPaths:['/fragments/0/actors/0/position']};
    if(kind==='instance')Object.assign(value,{instanceId:first.actorIds.leader,placementId:first.placementId,actorKey:'leader',values:{position:[120,180]}});
    if(kind==='positions')value.changes=[{instanceId:first.actorIds.leader,placementId:first.placementId,actorKey:'leader',position:[120,180]}];
    if(kind==='fragment')Object.assign(value,{instanceId:first.actorIds.leader,fragmentId:'party',actorKey:'leader',values:{speed:17},targets:[first,second].map(p=>({instanceId:p.actorIds.leader,placementId:p.placementId,overrides:[]}))});
    if(kind==='placement')Object.assign(value,{instanceId:second.actorIds.leader,fragmentId:'party',placementId:second.placementId,offset:[360,80],
      targets:Object.entries(second.actorIds).map(([actorKey,instanceId])=>({instanceId,actorKey})),groups:Object.entries(second.groupIds).map(([groupKey,groupId])=>({groupId,groupKey}))});
    if(kind==='structure')Object.assign(value,{edit:{action:'remove',fragmentId:'unused',actorKey:'a'},targets:[]});
    return api.realmJson(JSON.stringify(value));
  }
  function payload(value) {
    const next=fixture(api,value.afterContent),out={...next.model,previewId,draft:{baseSourceRevision:value.baseSourceRevision,sourceRevision:revision(value.afterContent)}};
    if(value.afterContent===definitionProposal.afterContent) {
      // Older portable fixtures intentionally omit declaration pointers. Only
      // this NEW definition-domain fixture needs the complete template paths
      // now verified by its candidate contract; retain old fixtures unchanged.
      const expanded=copy(api.expandSceneComposition(value.afterContent));
      for(const kind of ['actors','groups'])for(const[index,entry]of expanded.sourceMap[kind].entries())
        out.sourceLocations[kind][index].declaration.propertyPath=entry.templatePath;
    }
    return api.realmJson(JSON.stringify(out));
  }
  function owner() { return {open:true,session:1,selected:f.model.scene.objectId,sourcePath:f.source.sourcePath,previewSupported:true,previewActive:true,requestBusy:false,running:false,
    context:{editable:true,creating:false,busy:false,compositionSourceWritable:true,sceneDraftPath:f.source.sourcePath,sceneDraftToken:'source:1'},backend:{available:false}}; }
  function build(name='Override',kind='instance',ports={}) {
    const state=owner(),calls={released:[],applied:[],opened:[],review:[],write:[]},receipt={applied:true};
    const workflow=api.createSceneAuthoringWorkflow({kind,capabilityKey:`canEditComposition${name}`,isSupported:()=>true,getState:()=>state,
      getSource:async()=>api.realmJson(JSON.stringify(f.source)),loadCatalog:async()=>api.realmJson('{"images":[]}'),
      reviewCandidate:async(value,guard)=>{calls.review.push({value,guard});return payload(value);},releasePreview:id=>{calls.released.push(id);},digest:async text=>sha(text),
      applyDraft:async(value,guard)=>{calls.write.push({value,guard});assert.equal(guard.isCurrent(),true);state.context.sceneDraftToken='source:2';return receipt;},
      onApplied:(...args)=>calls.applied.push(args),...ports});
    const editor={open:async input=>{calls.opened.push(input);return true;}},input={model:api.realmJson(JSON.stringify(f.model)),actorId:f.ids[0],isCurrent:()=>true};
    return {workflow,state,calls,receipt,editor,input};
  }
  function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
  const all=[];
  for(const[name,kind]of domains){
    const h=build(name,kind),value=proposal(kind);all.push(h);
    assert.equal(h.workflow.canEdit(),true);assert.equal(await h.workflow.open(h.editor,h.input),true);
    assert.deepEqual(Object.keys(h.workflow.getContext()).sort(),['editable','creating','busy','compositionSourceWritable','sceneDraftPath','sceneDraftToken',`canEditComposition${name}`].sort());
    h.state.backend={available:true,id:'different-derived-backend',buildId:'other'};assert.equal(h.calls.opened[0].isCurrent(),true);
    assert.deepEqual(copy(await h.workflow.validateDraft(value)),{ok:true});assert.deepEqual(h.calls.released,[previewId]);
    const result=await h.workflow.applySourceDraft(value);assert.equal(result,h.receipt);assert.equal(h.workflow.sourceApplied(result,value),true);assert.equal(h.workflow.sourceApplied(result,value),false);
    assert.equal(h.calls.applied.length,1);assert.equal(h.calls.applied[0][0],result);
    checks.push({id:`portable-${name.toLowerCase()}-independent-open-review-write-single-use-completion`,ok:true});
  }
  {
    const h=build(),wait=deferred(),value=proposal('instance');
    const stale=build('Override','instance',{reviewCandidate:()=>wait.promise});const checking=stale.workflow.validateDraft(value);stale.state.context.sceneDraftToken='source:new';wait.resolve(payload(value));
    await assert.rejects(checking,error=>error?.errorCode==='scene_composition_override_conflict');assert.deepEqual(stale.calls.released,[previewId]);
    const malformed=build('Override','instance',{reviewCandidate:async value=>({...payload(value),ok:false})});
    await assert.rejects(malformed.workflow.validateDraft(value),error=>error?.errorCode==='scene_composition_override_invalid');assert.deepEqual(malformed.calls.released,[previewId]);
    checks.push({id:'stale-owner-and-malformed-candidate-refuse-and-release-temporary-preview',ok:true});
  }
  {
    const h=build(),value=proposal('instance'),result=await h.workflow.applySourceDraft(value);
    for(const sibling of all)assert.equal(sibling.workflow.sourceApplied(result,value),false);
    h.workflow.reset();assert.equal(h.workflow.sourceApplied(result,value),false);assert.equal(h.calls.applied.length,0);
    checks.push({id:'close-reset-and-sibling-domains-cannot-reuse-a-host-success-receipt',ok:true});
  }
  {
    for(const[kind,capabilityKey]of [['constructor','canEditCompositionOverride'],['instance','canEditCompositionStructure'],['layout','canEditCompositionLayout']])
      assert.throws(()=>api.createSceneAuthoringWorkflow({kind,capabilityKey}),error=>error?.errorCode==='scene_composition_override_invalid');
    const c=proposal('instance');for(const kind of ['constructor','layout','other'])assert.throws(()=>api.validateSceneAuthoringCandidate(kind,c,payload(c),{sourceRevision:revision(c.afterContent)}),error=>error?.errorCode==='scene_composition_override_invalid');
    checks.push({id:'unknown-domains-and-cross-capability-pairs-fail-closed',ok:true});
  }
  {
    const h=build(),wait=deferred(),stale=build('Override','instance',{getSource:()=>wait.promise}),original=stale.input.model.scene.objectId;
    const opening=stale.workflow.open(stale.editor,stale.input);stale.input.model.scene.objectId='wrong';stale.input.actorId=null;wait.resolve(api.realmJson(JSON.stringify(f.source)));
    assert.equal(await opening,true);assert.equal(stale.calls.opened[0].model.scene.objectId,original);assert.equal(stale.calls.opened[0].actorId,f.ids[0]);
    checks.push({id:'model-and-selected-actor-captured-before-source-await',ok:true});
  }
  {
    const h=build(),value=proposal('instance');let reads=0;
    Object.defineProperty(value,'afterContent',{enumerable:true,get(){reads++;return f.source.content;}});
    await assert.rejects(h.workflow.validateDraft(value),error=>error?.errorCode==='scene_composition_override_invalid');assert.equal(reads,0);assert.equal(h.calls.review.length,0);
    checks.push({id:'proposal-accessor-rejected-before-any-review-port-call',ok:true});
  }
  {
    const first=deferred(),second=deferred();let count=0;
    const h=build('Override','instance',{reviewCandidate:()=>++count===1?first.promise:second.promise}),value=proposal('instance');
    const older=h.workflow.validateDraft(value),newer=h.workflow.validateDraft(value);second.resolve(payload(value));await newer;first.resolve(payload(value));
    await assert.rejects(older,error=>error?.errorCode==='scene_composition_override_conflict');assert.deepEqual(h.calls.released,[previewId,previewId]);
    checks.push({id:'overlapping-review-requests-expire-the-older-owner-and-release-both-leases',ok:true});
  }
  return checks;
}

async function systemCases(api) {
  const checks=[], dto=v=>api.realmJson(JSON.stringify(v)), plain=v=>JSON.parse(JSON.stringify(v));
  const registry=api.createStudioModuleRegistry();
  const profile={format:'viento-studio-profile',schemaVersion:1,required:[{capability:'document.edit',apiVersion:1},{capability:'scene.representation.scene4d',apiVersion:1}],optional:[{capability:'behavior.rust',apiVersion:1}]};
  const plan=registry.plan(dto(profile));
  assert.equal(plan.modules.length,17);assert.equal(plan.capabilities.length,33);
  assert.deepEqual(plain(plan.requests).map(r=>r.status),['supported','missing','missing']);
  assert.equal(plan.capabilities.find(c=>c.capability==='document.edit').active,true);
  checks.push({id:'whole-system-modules-unknown4d-and-rust-local-diagnostics',ok:true});
  const unavailable=registry.plan(dto(profile),dto({enabledModules:{'org.viento.export':false}}));
  assert.equal(unavailable.capabilities.find(c=>c.capability==='resource.reference').active,true);
  assert.equal(unavailable.capabilities.find(c=>c.capability==='resource.package').active,false);
  checks.push({id:'optional-export-disable-keeps-author-resource-references',ok:true});
  const versioned={...profile,required:[{capability:'document.edit',apiVersion:2}],optional:[]};
  assert.equal(registry.plan(dto(versioned)).requests[0].status,'version_unsupported');
  checks.push({id:'api-mismatch-does-not-close-ordinary-document-module',ok:true});
  const future=registry.plan(dto({...profile,schemaVersion:99}));
  assert.equal(future.diagnostics[0].code,'studio_profile_invalid');
  assert.equal(future.modules.find(m=>m.id==='org.viento.document').active,true);
  checks.push({id:'future-schema-diagnostics-with-base-editor-preserved',ok:true});
  const model=api.createProjectModel(dto({paths:{documents:'documents',templates:'templates',metadata:'metadata'},documentTypes:[],templates:{}}));
  const workspace={version:3,documentTypes:[{id:'scene',label:'剧本场次',directory:'scenes',parserProfile:'prose'}],studioProfile:profile};
  const definition=model.projectDefinition(dto(workspace));
  assert.deepEqual(plain(definition.studioProfile),profile);
  assert.equal(definition.documentTypes[0].parserProfile,'prose');
  assert.equal(model.resolveDocumentDefinition(dto(workspace),'documents/scenes/第一场.md').parserProfile,'prose');
  checks.push({id:'drama-scene-is-prose-and-workspace-profile-is-detached',ok:true});
  const descriptors=plain(api.STUDIO_MODULES);
  descriptors[0].contributions.push({...descriptors[1].contributions[0]});
  assert.throws(()=>api.createStudioModuleRegistry(dto(descriptors)));
  assert.throws(()=>api.validateStudioProfile(dto({...profile,executable:'../not-code'})));
  checks.push({id:'declarative-provider-conflicts-and-executable-fields-refuse',ok:true});
  return checks;
}

async function transformCases(api) {
 const checks=[],model=JSON.parse(await fs.readFile(path.join(root,'examples/scene3d/scene.json'),'utf8'));
 const dto=v=>api.realmJson(JSON.stringify(v)),id=model.objects[0].instanceId;
 const original='\ufeff'+JSON.stringify(model,null,'\t').replaceAll('\n','\r\n')+'\r\n';
 const saved=`sha256:${sha(original)}`;
 const snapshot=content=>dto({sourcePath:'documents/scene.json',token:'copied:current',content,baseSourceRevision:saved,sourceRevision:`sha256:${sha(content)}`});
 assert.equal(api.supportsStudioCoreScene3DPatch(),true);
 for(const dirty of [false,true]) {
  const source=snapshot(original+(dirty?' ':''));
  const p=api.createScene3DTransformProposal(source,dto({instanceId:id,values:{position:[3,4,5],size:[2,3,4]}}));
  assert.equal(api.isScene3DTransformProposal(p),true);assert.equal(Object.isFrozen(p.values.position),true);
  assert.ok(p.afterContent.startsWith('\ufeff'));assert.ok(p.afterContent.includes('\r\n'));
  const after=JSON.parse(p.afterContent.slice(1));assert.deepEqual(after.objects.slice(1),model.objects.slice(1));
  const ready=await api.prepareScene3DTransformApply(source,p,{digest:sha});assert.equal(ready.afterContent,p.afterContent);
  checks.push({id:dirty?'unsaved-source-portable-transforms':'saved-source-portable-transforms',ok:true});
 }
 const source=snapshot(original),p=api.createScene3DTransformProposal(source,dto({instanceId:id,values:{position:[3,4,5]}}));
 await assert.rejects(api.prepareScene3DTransformApply(source,dto(p),{digest:sha}),e=>e.errorCode==='scene3d_transform_conflict');
 checks.push({id:'serialized-copy-retains-data-without-authority',ok:true});
 for(const field of ['token','baseSourceRevision','sourceRevision','content']) {
  const changed={...JSON.parse(JSON.stringify(source)),[field]:field.includes('Revision')?`sha256:${'0'.repeat(64)}`:'changed'};
  await assert.rejects(api.prepareScene3DTransformApply(dto(changed),p,{digest:sha}));
 }
 checks.push({id:'copied-source-all-revision-and-byte-guards',ok:true});
 assert.throws(()=>api.createScene3DTransformProposal(source,dto({instanceId:id,values:{size:model.objects[0].size}})),e=>e.errorCode==='scene3d_transform_unchanged');
 checks.push({id:'unchanged-native-patch-cannot-become-apply-proposal',ok:true});
 return checks;
}

async function objectsCases(api) {
 const checks=[],model=JSON.parse(await fs.readFile(path.join(root,'examples/scene3d/scene.json'),'utf8'));
 const dto=v=>api.realmJson(JSON.stringify(v)),plain=v=>JSON.parse(JSON.stringify(v)),id=model.objects[0].instanceId;
 const original='\ufeff'+JSON.stringify(model,null,'\t').replaceAll('\n','\r\n')+'\r\n';
 const saved=`sha256:${sha(original)}`,fresh='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const snapshot=content=>dto({sourcePath:'documents/scene.json',token:'copied:objects:current',content,baseSourceRevision:saved,sourceRevision:`sha256:${sha(content)}`});
 const parse=content=>JSON.parse(content.replace(/^\ufeff/,''));
 assert.equal(api.supportsStudioCoreScene3DObjectsPatch(),true);
 for(const dirty of [false,true]) {
  const source=snapshot(original+(dirty?' ':''));
  const object={...model.objects[0],instanceId:fresh,name:'Prepared independent box',position:[2,3,4]};
  const p=api.createScene3DObjectsProposal(source,dto({action:'add',object}));
  assert.equal(api.isScene3DObjectsProposal(p),true);assert.equal(Object.isFrozen(p.edit.object.position),true);
  assert.equal(p.beforeObject,null);assert.deepEqual(plain(p.afterObject),object);
  const after=parse(p.afterContent);assert.deepEqual(after.objects.slice(0,-1),model.objects);
  assert.deepEqual(after.camera,model.camera);assert.deepEqual(after.light,model.light);
  assert.ok(p.afterContent.startsWith('\ufeff'));assert.ok(p.afterContent.includes('\r\n'));
  assert.equal((await api.prepareScene3DObjectsApply(source,p,{digest:sha})).afterContent,p.afterContent);
  checks.push({id:dirty?'unsaved-source-independent-object-add':'saved-source-independent-object-add',ok:true});
 }
 {
  const start=original.indexOf('"objects"');
  const raw=original.slice(0,start)+original.slice(start).replace('"position": [','"posi\\u0074ion": [').replace('"name": "','"name": "\\u0041');
  const source=snapshot(raw),before=parse(raw),p=api.createScene3DObjectsProposal(source,dto({action:'copy',instanceId:id,newInstanceId:fresh,name:before.objects[0].name}));
  const after=parse(p.afterContent);assert.deepEqual(after.objects.slice(0,-1),before.objects);
  assert.deepEqual(after.objects.at(-1),{...before.objects[0],instanceId:fresh});assert.equal(p.sourceInstanceId,id);
  assert.equal(p.afterContent.split('"posi\\u0074ion"').length,3);
  assert.equal(p.afterContent.split('"name": "\\u0041').length,3);
  assert.equal((await api.prepareScene3DObjectsApply(source,p,{digest:sha})).afterContent,p.afterContent);
  checks.push({id:'copied-raw-object-retains-escaped-keys-and-same-semantic-name-token',ok:true});
 }
 {
  for(const selected of model.objects) {
   const source=snapshot(original),p=api.createScene3DObjectsProposal(source,dto({action:'remove',instanceId:selected.instanceId}));
   const after=parse(p.afterContent);assert.deepEqual(after.objects,model.objects.filter(o=>o.instanceId!==selected.instanceId));
   assert.deepEqual(after.camera,model.camera);assert.deepEqual(after.light,model.light);
   await api.prepareScene3DObjectsApply(source,p,{digest:sha});
  }
  const one={...model,objects:[model.objects[0]]};
  assert.throws(()=>api.createScene3DObjectsProposal(snapshot(JSON.stringify(one)),dto({action:'remove',instanceId:id})),e=>e.errorCode==='scene3d_objects_invalid');
  checks.push({id:'first-middle-last-removal-retains-survivor-order-and-refuses-last-primitive',ok:true,removePositions:model.objects.length});
 }
 {
  const source=snapshot(original),p=api.createScene3DObjectsProposal(source,dto({action:'copy',instanceId:id,newInstanceId:fresh,name:'Independent copy'}));
  const t=api.createScene3DTransformProposal(source,dto({instanceId:id,values:{position:[3,4,5]}}));
  assert.equal(api.isScene3DTransformProposal(p),false);assert.equal(api.isScene3DObjectsProposal(t),false);
  await assert.rejects(api.prepareScene3DObjectsApply(source,t,{digest:sha}),e=>e.errorCode==='scene3d_objects_conflict');
  await assert.rejects(api.prepareScene3DTransformApply(source,p,{digest:sha}),e=>e.errorCode==='scene3d_transform_conflict');
  await assert.rejects(api.prepareScene3DObjectsApply(source,dto(p),{digest:sha}),e=>e.errorCode==='scene3d_objects_conflict');
  const copied=snapshot(p.afterContent),changed=api.createScene3DTransformProposal(copied,dto({instanceId:fresh,values:{position:[8,3,1]}}));
  const ready=await api.prepareScene3DTransformApply(copied,changed,{digest:sha});
  assert.deepEqual(parse(ready.afterContent).objects[0],model.objects[0]);
  assert.deepEqual(parse(ready.afterContent).objects.at(-1).position,[8,3,1]);
  checks.push({id:'private-brands-are-isolated-and-explicit-copied-object-transform-is-independent',ok:true});
 }
 {
  const source=snapshot(original),p=api.createScene3DObjectsProposal(source,dto({action:'copy',instanceId:id,newInstanceId:fresh,name:'Copy'}));
  for(const [field,value]of [['token','stale'],['sourcePath','documents/other.json'],['content',original+' '],['sourceRevision',`sha256:${'0'.repeat(64)}`],['baseSourceRevision',`sha256:${'0'.repeat(64)}`]]) {
   await assert.rejects(api.prepareScene3DObjectsApply(dto({...plain(source),[field]:value}),p,{digest:sha}),e=>e.errorCode==='scene3d_objects_conflict');
  }
  await assert.rejects(api.prepareScene3DObjectsApply(source,p,{digest:()=> '0'.repeat(64)}),e=>e.errorCode==='scene3d_objects_conflict');
  assert.throws(()=>api.createScene3DObjectsProposal(source,dto({action:'copy',instanceId:id,newInstanceId:id,name:'Collision'})),e=>e.errorCode==='scene3d_objects_invalid');
  checks.push({id:'source-path-token-raw-both-revisions-digest-and-identity-collision-refuse',ok:true});
 }
 return checks;
}


async function environmentCases(api) {
 const checks=[],model=JSON.parse(await fs.readFile(path.join(root,'examples/scene3d/scene.json'),'utf8'));
 const dto=v=>api.realmJson(JSON.stringify(v)),plain=v=>JSON.parse(JSON.stringify(v));
 const original='\ufeff'+JSON.stringify(model,null,'\t').replaceAll('\n','\r\n')+'\r\n',saved=`sha256:${sha(original)}`;
 const snapshot=content=>dto({sourcePath:'documents/scene.json',token:'copied:environment:current',content,baseSourceRevision:saved,sourceRevision:`sha256:${sha(content)}`});
 const parse=content=>JSON.parse(content.replace(/^\ufeff/,''));
 const values={background:'#123456',camera:{position:[12,8,11],target:[1,2,0],fovDegrees:65,near:2000,far:3000},light:{direction:[1,-2,3],color:'#abcdef',energy:0}};
 for(const dirty of [false,true]) {
  const content=original+(dirty?' \t':''),source=snapshot(content),p=api.createScene3DEnvironmentProposal(source,dto({values}));
  const after=parse(p.afterContent);assert.deepEqual(after.objects,model.objects);assert.deepEqual(after.viewport,model.viewport);assert.equal(after.name,model.name);
  const expected={...model,...values};assert.deepEqual(after,expected);
  assert.ok(p.afterContent.startsWith('\ufeff'));assert.ok(p.afterContent.endsWith(dirty?'\r\n \t':'\r\n'));
  assert.equal((await api.prepareScene3DEnvironmentApply(source,p,{digest:sha})).afterContent,p.afterContent);
 }
 checks.push({id:'saved-dirty-complete-mixed-environment-clipping-atomic-objects-identity-and-format-retained',ok:true,modes:2});
 {
  const source=snapshot(original);assert.throws(()=>api.createScene3DEnvironmentProposal(source,dto({values:{camera:{near:2000}}})));
  assert.throws(()=>api.createScene3DEnvironmentProposal(source,dto({values:{camera:{position:model.camera.target}}})));
  const p=api.createScene3DEnvironmentProposal(source,dto({values:{camera:{position:model.camera.target,target:[3,1,5]}}}));
  assert.deepEqual(plain(p.afterEnvironment.camera.position),model.camera.target);await api.prepareScene3DEnvironmentApply(source,p,{digest:sha});
  checks.push({id:'camera-position-target-and-near-far-final-validation-crosses-invalid-intermediate-values',ok:true});
 }
 {
  const raw=original.replace('"background"','"back\\u0067round"').replace('"#0d1829"','"#0d\\u0031829"').replace('"near": 0.1','"near": 1e-1');
  const source=snapshot(raw);assert.throws(()=>api.createScene3DEnvironmentProposal(source,dto({values:{background:model.background,camera:{near:.1}}})),e=>e.errorCode==='scene3d_environment_unchanged');
  const p=api.createScene3DEnvironmentProposal(source,dto({values:{background:model.background,camera:{near:.1,fovDegrees:70}}}));
  assert.equal(p.afterContent,raw.replace('"fovDegrees": 50','"fovDegrees": 70'));
  checks.push({id:'native-noop-pure-refusal-and-explicit-unchanged-escaped-color-key-number-lexemes',ok:true});
 }
 {
  const s=snapshot(original),p=api.createScene3DEnvironmentProposal(s,dto({values:{background:'#234567'}}));
  const object=api.createScene3DObjectsProposal(s,dto({action:'copy',instanceId:model.objects[0].instanceId,newInstanceId:'60000000-1111-4111-8111-111111111111',name:'copy'}));
  const transform=api.createScene3DTransformProposal(s,dto({instanceId:model.objects[0].instanceId,values:{position:[7,8,9]}}));
  for(const other of [object,transform,dto(plain(p))]) await assert.rejects(api.prepareScene3DEnvironmentApply(s,other,{digest:sha}),e=>e.errorCode==='scene3d_environment_conflict');
  await assert.rejects(api.prepareScene3DObjectsApply(s,p,{digest:sha}),e=>e.errorCode==='scene3d_objects_conflict');
  await assert.rejects(api.prepareScene3DTransformApply(s,p,{digest:sha}),e=>e.errorCode==='scene3d_transform_conflict');
  checks.push({id:'three-independent-private-brands-cannot-cross-or-be-obtained-by-json-cloning',ok:true});
 }
 {
  const source=snapshot(original),p=api.createScene3DEnvironmentProposal(source,dto({values:{light:{energy:.25}}}));
  for(const [field,value]of [['token','stale'],['sourcePath','documents/other.json'],['content',original+' '],['sourceRevision',`sha256:${'0'.repeat(64)}`],['baseSourceRevision',`sha256:${'0'.repeat(64)}`]])
   await assert.rejects(api.prepareScene3DEnvironmentApply(dto({...plain(source),[field]:value}),p,{digest:sha}),e=>e.errorCode==='scene3d_environment_conflict');
  await assert.rejects(api.prepareScene3DEnvironmentApply(source,p,{digest:()=> '0'.repeat(64)}),e=>e.errorCode==='scene3d_environment_conflict');
  checks.push({id:'exact-five-field-source-and-real-digest-authority-guarded',ok:true});
 }
 {
  const source=snapshot(original);
  for(const values of [{},{camera:{}},{light:{direction:[0,0,0]}},{light:{direction:[0,1,0]}},{camera:{far:.1}},{camera:{fovDegrees:180}},{light:{energy:17}},{background:'#xyzxyz'},{objects:[]}])
   assert.throws(()=>api.createScene3DEnvironmentProposal(source,dto({values})));
  const p=api.createScene3DEnvironmentProposal(source,dto({values:{light:{energy:0}}}));assert.equal(p.afterEnvironment.light.energy,0);
  checks.push({id:'invalid-shapes-whole-camera-light-ranges-refuse-with-valid-zero-energy',ok:true});
 }
 return checks;
}

async function propertiesCases(api) {
 const model=JSON.parse(await fs.readFile(path.join(root,'examples/scene3d/scene.json')));
 const original='\ufeff'+JSON.stringify(model,null,'\t').replaceAll('\n','\r\n')+'\r\n';
 const dto=value=>api.realmJson(JSON.stringify(value)), plain=value=>JSON.parse(JSON.stringify(value));
 const snapshot=content=>dto({sourcePath:'documents/scene.json',token:'copied:properties:current',content,baseSourceRevision:`sha256:${sha(original)}`,sourceRevision:`sha256:${sha(content)}`});
 const id=model.objects[1].instanceId, checks=[];
 assert.equal(api.supportsStudioCoreScene3DPropertiesPatch(),true);
 for(const dirty of [false,true]) {
  const content=original+(dirty?' \t':''),s=snapshot(content),p=api.createScene3DPropertiesProposal(s,dto({instanceId:id,values:{color:'#ABCdef',name:' 原文\r\n🎭 '}}));
  assert.deepEqual(plain(p.changedPaths),['/objects/1/name','/objects/1/color']);
  assert.deepEqual(plain(p.afterObject),{...model.objects[1],name:' 原文\r\n🎭 ',color:'#ABCdef'});
  const after=JSON.parse(p.afterContent.slice(1));for(const key of ['camera','light','background','viewport','name'])assert.deepEqual(after[key],model[key]);
  assert.equal(after.objects[1].instanceId,id);assert.equal((await api.prepareScene3DPropertiesApply(s,p,{digest:sha})).afterContent,p.afterContent);
  assert.ok(p.afterContent.startsWith('\ufeff')&&p.afterContent.endsWith(dirty?'\r\n \t':'\r\n'));
 }
 checks.push({id:'saved-dirty-selected-properties-stable-id-geometry-and-environment-retained',ok:true,modes:2});
 {
  const s=snapshot(original),p=api.createScene3DPropertiesProposal(s,dto({instanceId:id,values:{name:model.objects[1].name,color:'#87D8B9'}}));
  assert.deepEqual(plain(p.changedPaths),['/objects/1/color']);assert.equal(p.afterContent,original.replace('"#87d8b9"','"#87D8B9"'));
  assert.throws(()=>api.createScene3DPropertiesProposal(s,dto({instanceId:id,values:{name:model.objects[1].name,color:model.objects[1].color}})),e=>e.errorCode==='scene3d_properties_unchanged');
  checks.push({id:'native-noop-refused-and-explicit-color-case-change-only',ok:true});
 }
 {
  const s=snapshot(original),p=api.createScene3DPropertiesProposal(s,dto({instanceId:id,values:{name:' 🎭\r\n '}}));
  assert.equal(p.afterObject.name,' 🎭\r\n ');assert.equal(api.createScene3DPropertiesProposal(s,dto({instanceId:id,values:{name:'🎭'.repeat(256)}})).afterObject.name,'🎭'.repeat(256));
  assert.throws(()=>api.createScene3DPropertiesProposal(s,dto({instanceId:id,values:{name:'🎭'.repeat(257)}})));
  checks.push({id:'raw-whitespace-crlf-astral-codepoint-boundary-preserved',ok:true});
 }
 {
  const s=snapshot(original),p=api.createScene3DPropertiesProposal(s,dto({instanceId:id,values:{name:'properties'}}));
  const others=[api.createScene3DEnvironmentProposal(s,dto({values:{background:'#123456'}})),api.createScene3DTransformProposal(s,dto({instanceId:id,values:{position:[4,5,6]}})),api.createScene3DObjectsProposal(s,dto({action:'copy',instanceId:id,newInstanceId:'60000000-1111-4111-8111-111111111111',name:'copy'}))];
  for(const other of [...others,dto(plain(p))])await assert.rejects(api.prepareScene3DPropertiesApply(s,other,{digest:sha}),e=>e.errorCode==='scene3d_properties_conflict');
  checks.push({id:'four-private-brands-and-json-cloning-do-not-grant-property-authority',ok:true});
 }
 {
  const s=snapshot(original),p=api.createScene3DPropertiesProposal(s,dto({instanceId:id,values:{color:'#123456'}}));
  for(const field of ['sourcePath','token','content','baseSourceRevision','sourceRevision'])await assert.rejects(api.prepareScene3DPropertiesApply(dto({...plain(s),[field]:field.includes('Revision')?`sha256:${'0'.repeat(64)}`:field==='sourcePath'?'documents/other.json':plain(s)[field]+' ' }),p,{digest:sha}),e=>e.errorCode==='scene3d_properties_conflict');
  await assert.rejects(api.prepareScene3DPropertiesApply(s,p,{digest:()=> '0'.repeat(64)}));
  checks.push({id:'exact-five-field-source-owner-byte-revisions-and-digest-bound',ok:true});
 }
 {
  const s=snapshot(original);for(const values of [{},{name:''},{color:'#fff'},{position:[1,2,3]},{color:null},{name:'valid',unknown:true}])assert.throws(()=>api.createScene3DPropertiesProposal(s,dto({instanceId:id,values})));
  assert.throws(()=>api.createScene3DPropertiesProposal(s,dto({instanceId:'60000000-1111-4111-8111-111111111111',values:{name:'missing'}})));
  checks.push({id:'invalid-shapes-geometry-and-missing-instances-refuse',ok:true});
 }
 return checks;
}

async function navigationCases(api) {
 const checks=[],model=JSON.parse(await fs.readFile(path.join(root,'examples/scene3d/scene.json')));
 const dto=value=>api.realmJson(JSON.stringify(value)),plain=value=>JSON.parse(JSON.stringify(value));
 model.name='箱🦊';model.objects[0].name=' Blue [箱🦊] ';
 const raw='\ufeff'+JSON.stringify(model,null,'\t').replaceAll('\n','\r\n')+'\r\n \t';
 const parsed=api.parseScene3DSource(raw),index=api.createScene3DObjectIndex(parsed);
 assert.ok(Object.isFrozen(index)&&Object.isFrozen(index.objects));
 assert.equal(api.queryScene3DObjects(index,'  BLUE ').length,1);assert.equal(api.queryScene3DObjects(index,'🦊')[0].instanceId,model.objects[0].instanceId);
 checks.push({id:'readonly-detached-frozen-native-model-index-and-unicode-query',ok:true});
 assert.deepEqual(plain(api.queryScene3DObjects(index,model.objects[1].instanceId.toUpperCase())).map(row=>row.instanceId),[model.objects[1].instanceId]);
 assert.equal(api.queryScene3DObjects(index,'[').length,1);assert.equal(api.queryScene3DObjects(index,'missing').length,0);assert.equal(api.queryScene3DObjects(index,'  ').length,model.objects.length);
 checks.push({id:'literal-name-uuid-case-substrings-empty-and-no-results-without-author-mutation',ok:true});
 assert.throws(()=>api.queryScene3DObjects(dto(plain(index)),'Blue'),e=>e.errorCode==='scene3d_navigation_invalid');
 assert.throws(()=>api.queryScene3DObjects(index,dto({toString:'Blue'})),e=>e.errorCode==='scene3d_navigation_invalid');
 checks.push({id:'serialized-index-and-nonstrings-cannot-impersonate-display-session',ok:true});
 const snapshot=dto({sourcePath:'documents/scenes/箱.json',token:'portable-navigation',content:raw}),location=api.createScene3DSourceLocation(snapshot,model.objects[1].instanceId);
 assert.ok(api.isScene3DSourceLocation(location)&&Object.isFrozen(location)&&Object.isFrozen(location.sourceRange));
 assert.deepEqual(JSON.parse(raw.slice(location.sourceRange.start,location.sourceRange.end)),model.objects[1]);
 checks.push({id:'readonly-strict-source-snapshot-native-stable-uuid-and-raw-exact-location',ok:true});
 const displayed=raw.replace(/\r\n|\r/g,'\n'),selection=api.scene3DSourceDisplaySelection(location,displayed);
 assert.deepEqual(JSON.parse(displayed.slice(selection.start,selection.end)),model.objects[1]);assert.equal(location.content,raw);
 checks.push({id:'bom-crlf-astral-native-source-range-translates-only-into-textarea-display',ok:true});
 assert.equal(api.isScene3DSourceLocation(dto(plain(location))),false);assert.equal(api.isScene3DPropertiesProposal(location),false);
 assert.throws(()=>api.scene3DSourceDisplaySelection(location,displayed+' '),e=>e.errorCode==='scene3d_navigation_invalid');
 assert.throws(()=>api.createScene3DSourceLocation(dto({...plain(snapshot),sourceRange:{start:0,end:1}}),model.objects[1].instanceId),e=>e.errorCode==='scene3d_navigation_invalid');
 checks.push({id:'forged-cloned-navigation-range-and-changed-display-reject-with-no-author-brand',ok:true});
 model.objects.reverse();const next=api.createScene3DSourceLocation(dto({...plain(snapshot),content:JSON.stringify(model)}),model.objects.at(-1).instanceId);
 assert.equal(next.propertyPath,`/objects/${model.objects.length-1}`);
 checks.push({id:'source-reorder-resolves-same-uuid-in-new-native-position',ok:true});
 const box=model.objects[0];model.objects=Array.from({length:128},(_,i)=>({...box,name:i%2?'Box':'箱',instanceId:`${i.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`}));
 const large=api.createScene3DObjectIndex(api.parseScene3DSource(JSON.stringify(model)));
 assert.equal(api.queryScene3DObjects(large,'Box').length,64);assert.equal(api.queryScene3DObjects(large,'').length,128);
 checks.push({id:'maximum-128-native-declarations-preserve-order-and-filter-independently',ok:true});
 const camera=dto({position:[8,6,8],target:[0,0,0],fovDegrees:1,near:10000,far:100000}),frameBox=dto({...model.objects[0],position:[100000,-100000,100000],size:[1000,500,.001]});
 const framed=api.frameCamera(camera,frameBox,1/8192);assert.ok(Object.isFrozen(framed)&&Object.isFrozen(framed.position)&&Object.isFrozen(framed.target));
 assert.deepEqual(plain(framed.target),plain(frameBox.position));assert.ok(Math.hypot(...plain(framed.position).map((v,i)=>v-frameBox.position[i]))>200000);
 assert.equal(camera.near,10000);assert.equal(camera.far,100000);
 checks.push({id:'copied-pure-framing-stays-finite-beyond-default-orbit-distance-with-authored-camera-unchanged',ok:true});
 const eye=plain(framed.position).map((v,i)=>v-framed.target[i]),view=api.multiply4(api.perspective4(framed.fovDegrees,1/8192,framed.near,framed.far),api.lookAt4(eye,dto([0,0,0]))),object=api.objectMatrix4(dto({...plain(frameBox),position:[0,0,0]})),matrix=plain(api.multiply4(view,object));
 for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){const v=[x,y,z,1],clip=Array.from({length:4},(_,r)=>v.reduce((total,n,c)=>total+matrix[c*4+r]*n,0));assert.ok(clip.every(Number.isFinite)&&clip[3]>0);assert.ok(clip.slice(0,3).every(n=>Math.abs(n/clip[3])<1));}
 checks.push({id:'copied-pure-camera-full-rotated-box-corners-fit-actual-narrow-frustum-and-clipping',ok:true,corners:8});
 return checks;
}


async function pickingCases(api) {
 const checks=[],dto=value=>api.realmJson(JSON.stringify(value)),plain=value=>JSON.parse(JSON.stringify(value));
 const f32=value=>Array.from(new Float32Array(value));
 const camera={position:[0,0,6],target:[0,0,0],fovDegrees:60,near:.1,far:100};
 const shape=(id,position=[0,0,0],size=[1,1,1],rotationDegrees=[0,0,0])=>({instanceId:id,position,size,rotationDegrees});
 const frame=(objects,view=camera,rect={left:71,top:43,width:100.4,height:201.5},width=201,height=403)=>{
  const eye=view.position.map((v,i)=>v-view.target[i]);
  return dto({rect,width,height,viewProjection:f32(api.multiply4(api.perspective4(view.fovDegrees,width/height,view.near,view.far),api.lookAt4(dto(eye),dto([0,0,0])))),
   objects:objects.map(o=>({instanceId:o.instanceId,model:f32(api.objectMatrix4(dto({...o,position:o.position.map((v,i)=>v-view.target[i])})))}))});
 };
 const center=f=>[f.rect.left+f.rect.width/2,f.rect.top+f.rect.height/2];
 const pick=(f,...xy)=>api.pickScene3DObject(f,...(xy.length?xy:center(f)));
 let f=frame([shape('one')]),before=JSON.stringify(f);
 assert.equal(pick(f),'one');assert.equal(JSON.stringify(f),before);
 assert.equal(pick(f,f.rect.left,f.rect.top),null);assert.equal(pick(f,f.rect.left+f.rect.width,f.rect.top),null);
 checks.push({id:'copied-Float32-frame-CSS-offset-rounded-buffer-aspect-center-and-empty-geometry-without-mutation',ok:true});
 f=frame([shape('rear',[0,0,-2]),shape('front',[0,0,1])]);assert.equal(pick(f),'front');
 f=frame([shape('first'),shape('last')]);assert.equal(pick(f),'last');
 checks.push({id:'nearest-visible-face-occludes-rear-and-exact-depth-LEQUAL-tie-follows-last-draw',ok:true});
 f=frame([shape('rotated',[0,0,0],[.4,3,.75],[23,-41,67])]);assert.equal(pick(f),'rotated');
 checks.push({id:'rotated-nonuniform-box-is-picked-through-uploaded-model-inverse',ok:true});
 const inside={...camera,position:[0,0,0],target:[0,0,-1],near:.1,far:20};
 f=frame([shape('inside')],inside);assert.equal(pick(f),'inside');
 f=frame([shape('no-visible-face')],{...inside,far:.2});assert.equal(pick(f),null);
 checks.push({id:'near-plane-inside-box-uses-exit-face-and-never-invents-near-plane-cap',ok:true});
 f=frame([shape('wide',[0,0,-100])],{...inside,near:.001,far:100000});
 assert.equal(f.viewProjection[10],-1);assert.equal(pick(f),'wide');
 checks.push({id:'Float32-wide-clip-ratio-finite-near-middle-ray-does-not-unproject-infinite-far',ok:true});
 const target=shape('tiny',[100000,-100000,100000],[.001,.001,.001],[173,-35999,67]);
 const focused=api.frameCamera(dto({position:[8,6,8],target:[0,0,0],fovDegrees:1,near:10000,far:100000}),dto(target),1/2048);
 f=frame([target],plain(focused),{left:5,top:7,width:1,height:8192},1,2048);
 const m=f.viewProjection,w=m[15],x=m[12]/w,y=m[13]/w;
 assert.equal(pick(f,f.rect.left+(x+1)*f.rect.width/2,f.rect.top+(1-y)*f.rect.height/2),'tiny');
 checks.push({id:'target-relative-Float32-tiny-distant-rotated-box-and-extreme-focused-canvas-remain-pickable',ok:true});
 f=frame([shape('one')]);assert.equal(pick(f,NaN,1),null);assert.equal(api.pickScene3DObject(null,0,0),null);
 assert.equal(pick(dto({...plain(f),viewProjection:Array(16).fill(0)})),null);
 assert.equal(pick(dto({...plain(f),objects:[{instanceId:'invalid',model:Array(16).fill(0)}]})),null);
 assert.equal(pick(dto({...plain(f),rect:{...plain(f.rect),width:0}})),null);
 checks.push({id:'invalid-coordinate-hidden-rect-singular-frame-and-singular-object-refuse-without-throw-or-author-authority',ok:true});
 f=frame(Array.from({length:128},(_,i)=>shape(`object-${i}`)));before=JSON.stringify(f);
 assert.equal(pick(f),'object-127');assert.equal(JSON.stringify(f),before);
 checks.push({id:'maximum-current128-draw-identities-stay-source-ordered-and-detached-with-no-source-interface',ok:true});
 return checks;
}


async function selectionCases(api) {
 const checks=[],plain=value=>JSON.parse(JSON.stringify(value)),dto=value=>api.realmJson(JSON.stringify(value));
 const first='00000000-0000-4000-8000-000000000001',last='00000000-0000-4000-8000-000000000002';
 const author={format:'viento-scene3d',schemaVersion:1,name:'Prepared selection',viewport:[800,600],background:'#142538',
  camera:{position:[0,0,8],target:[0,0,0],fovDegrees:60,near:.1,far:100},light:{direction:[1,-2,-1],color:'#ffffff',energy:1},
  objects:[first,last].map((instanceId,index)=>({instanceId,name:`Box ${index}`,primitive:'box',position:[0,0,0],rotationDegrees:[23,-41,67],size:[2,2,2],color:index?'#ffffff':'#ffd700'}))};
 const model=api.parseScene3DSource(JSON.stringify(author)).model;
 function fixture(onPick) {
  const calls=[],listeners=new Map(),captures=new Set(),state={lost:false,dpr:1,bounds:{left:0,top:0,width:300,height:200},disconnects:0};let resized,next=0;
  const constants=['COMPILE_STATUS','LINK_STATUS','VERTEX_SHADER','FRAGMENT_SHADER','ARRAY_BUFFER','STATIC_DRAW','FLOAT','DEPTH_TEST','LEQUAL','CULL_FACE','COLOR_BUFFER_BIT','DEPTH_BUFFER_BIT','TRIANGLES'];
  const gl=Object.fromEntries(constants.map((name,index)=>[name,index+1]));
  for(const name of ['createProgram','createShader','createBuffer','createVertexArray'])gl[name]=()=>{const value={name,id:++next};calls.push([name,value]);return value;};
  for(const name of ['attachShader','shaderSource','compileShader','linkProgram','bindVertexArray','bindBuffer','bufferData','enableVertexAttribArray','vertexAttribPointer','viewport','enable','depthFunc','disable','clearColor','clear','useProgram','uniformMatrix4fv','uniform3fv','uniform1f','uniform1i','drawArrays','deleteBuffer','deleteVertexArray','deleteProgram','deleteShader'])gl[name]=(...values)=>calls.push([name,...values]);
  gl.getShaderParameter=gl.getProgramParameter=()=>true;gl.getShaderInfoLog=gl.getProgramInfoLog=()=>'';gl.getUniformLocation=(_,name)=>name;gl.isContextLost=()=>state.lost;
  gl.getExtension=()=>({loseContext(){state.lost=true;calls.push(['loseContext']);}});
  const canvas={width:0,height:0,getContext:()=>gl,getBoundingClientRect:()=>state.bounds,
   addEventListener(name,callback){listeners.set(name,callback);},removeEventListener(name,callback){if(listeners.get(name)===callback)listeners.delete(name);},
   setPointerCapture(id){captures.add(id);},hasPointerCapture:id=>captures.has(id),
   releasePointerCapture(id){captures.delete(id);listeners.get('lostpointercapture')?.({pointerId:id});}};
  const renderer=api.createScene3DRenderer(canvas,{onPick,pixelRatio:()=>state.dpr,observe(callback){resized=callback;return{observe(){},disconnect(){state.disconnects++;}};}});
  const send=(name,extra={})=>listeners.get(name)?.({button:0,isPrimary:true,pointerId:1,clientX:150,clientY:100,timeStamp:100,...extra});
  const click=timeStamp=>{send('pointerdown',{timeStamp});send('pointerup',{timeStamp});};
  return{renderer,canvas,gl,calls,listeners,captures,state,send,click,resize:()=>resized()};
 }
 {
  const f=fixture(),r=f.renderer;assert.equal(r.setSelectedObject(null),false);assert.equal(r.setModel(model),true);
  const before=plain(r.snapshot()),raw=JSON.stringify(model),hit=r.hitTest(150,100);assert.equal(hit,last);assert.equal(before.selectedInstanceId,null);
  for(const id of [undefined,'',false,{},'00000000-0000-4000-8000-000000000099'])assert.equal(r.setSelectedObject(id),false);
  assert.deepEqual(plain(r.snapshot()),before);assert.equal(r.setSelectedObject(last),true);assert.equal(r.snapshot().selectedInstanceId,last);
  assert.equal(r.snapshot().draws,before.draws+1);assert.deepEqual(plain(r.snapshot().camera),before.camera);assert.equal(r.hitTest(150,100),hit);assert.equal(JSON.stringify(model),raw);
  const selected=plain(r.snapshot()),calls=f.calls.length;assert.equal(r.setSelectedObject(last),true);assert.deepEqual(plain(r.snapshot()),selected);assert.equal(f.calls.length,calls);
  assert.equal(r.setSelectedObject(null),true);assert.equal(r.snapshot().selectedInstanceId,null);const cleared=plain(r.snapshot());assert.equal(r.setSelectedObject(null),true);assert.deepEqual(plain(r.snapshot()),cleared);r.dispose();
  checks.push({id:'copied-renderer-stable-selection-null-invalid-and-same-UUID-no-redraw-with-camera-model-picking-unchanged',ok:true});
 }
 {
  const f=fixture(),r=f.renderer;r.setModel(model);const payload=()=>f.calls.filter(call=>call[0]==='uniformMatrix4fv').map(call=>[call[1],Array.from(call[3])]);
  const matrices=payload(),start=f.calls.length,allocations=f.calls.filter(call=>/^(create|bufferData)/.test(call[0])).length;r.setSelectedObject(last);const current=f.calls.slice(start);
  assert.deepEqual(current.filter(call=>call[0]==='uniformMatrix4fv').map(call=>[call[1],Array.from(call[3])]),matrices);
  assert.deepEqual(current.filter(call=>call[0]==='uniform1i').map(call=>call.slice(1)),[['selected',0],['selected',1]]);
  assert.deepEqual(current.filter(call=>call[0]==='drawArrays').map(call=>call.slice(1)),[[f.gl.TRIANGLES,0,36],[f.gl.TRIANGLES,0,36]]);
  assert.deepEqual(current.filter(call=>call[0]==='depthFunc').map(call=>call[1]),[f.gl.LEQUAL]);assert.equal(current.filter(call=>call[0]==='clear').length,1);
  assert.equal(f.calls.filter(call=>/^(create|bufferData)/.test(call[0])).length,allocations);assert.equal(r.hitTest(150,100),last);r.dispose();
  checks.push({id:'copied-renderer-selection-uses-actual-Float32-upload-payloads-one-original-depth-pass-and-stable-source-order',ok:true,draws:2});
 }
 {
  let r;const hints=[],f=fixture((id,hint)=>{assert.ok(Object.isFrozen(hint));hints.push([id,hint.focus]);assert.equal(r.setSelectedObject(id),true);});r=f.renderer;r.setModel(model);
  const camera=plain(r.snapshot().camera),draws=r.snapshot().draws;f.click(100);f.click(200);f.send('dblclick',{timeStamp:201});
  assert.deepEqual(hints,[[last,false],[last,false],[last,true]]);assert.equal(r.snapshot().draws,draws+1);assert.deepEqual(plain(r.snapshot().camera),camera);assert.equal(f.captures.size,0);
  f.click(300);const count=hints.length;r.render();f.send('dblclick',{timeStamp:301});assert.equal(hints.length,count);r.dispose();
  checks.push({id:'copied-renderer-pointerup-release-selection-repaint-second-tap-dblclick-preserve-owner-while-public-render-revokes',ok:true});
 }
 {
  for(const change of ['backing','size','dpr']){
   const hints=[],f=fixture((id,hint)=>hints.push([id,hint.focus])),r=f.renderer;r.setModel(model);f.click(100);const count=hints.length;
   if(change==='backing')f.canvas.width++;if(change==='size')f.state.bounds.width=300.01;if(change==='dpr')f.state.dpr=2;
   r.setSelectedObject(last);f.send('dblclick',{timeStamp:101});assert.equal(hints.length,count,change);r.dispose();
  }
  const f=fixture(),r=f.renderer;r.setModel(model);r.setSelectedObject(last);r.focusObject(last);r.resetView();assert.equal(r.snapshot().selectedInstanceId,last);assert.deepEqual(plain(r.snapshot().camera),plain(model.camera));
  r.setModel(model);assert.equal(r.snapshot().selectedInstanceId,null);assert.equal(r.setSelectedObject(last),true);f.resize();assert.equal(r.snapshot().selectedInstanceId,last);r.dispose();
  checks.push({id:'copied-renderer-stale-backing-size-DPR-invalidate-selection-draw-approval-reset-retains-model-refresh-clears',ok:true});
 }
 {
  const hints=[],f=fixture((id,hint)=>hints.push([id,hint.focus])),r=f.renderer;r.setModel(model);r.setSelectedObject(last);r.setSelectedObject(null);assert.deepEqual(hints,[]);
  r.setSelectedObject(last);const before=plain(r.snapshot()),calls=f.calls.length;f.state.lost=true;assert.equal(r.setSelectedObject(null),false);assert.equal(r.setSelectedObject(last),false);assert.deepEqual(plain(r.snapshot()),before);assert.equal(f.calls.length,calls);
  r.dispose();r.dispose();assert.equal(r.snapshot().selectedInstanceId,null);assert.equal(r.setSelectedObject(null),false);assert.equal(r.hitTest(150,100),null);assert.equal(r.render(),false);assert.equal(f.listeners.size,0);assert.equal(f.captures.size,0);assert.equal(f.state.disconnects,1);
  for(const [name,count]of [['deleteShader',2],['deleteProgram',1],['deleteBuffer',1],['deleteVertexArray',1],['loseContext',1]])assert.equal(f.calls.filter(call=>call[0]===name).length,count);
  const bare=fixture(),b=bare.renderer;b.setModel(model);assert.equal(b.setSelectedObject(last),true);b.dispose();
  checks.push({id:'copied-renderer-feedback-has-no-pick-side-effect-lost-context-refuses-and-dispose-releases-all-owned-resources',ok:true});
 }
 return checks;
}


async function translationCases(api) {
 const checks=[],dto=value=>api.realmJson(JSON.stringify(value)),plain=value=>JSON.parse(JSON.stringify(value));
 const value=JSON.parse(await fs.readFile(path.join(root,'examples/scene3d/scene.json'),'utf8')),ids=value.objects.map(object=>object.instanceId);
 const text=model=>'\uFEFF'+JSON.stringify(model,null,'\t').replaceAll('\n','\r\n')+'\r\n \t';
 const snapshot=(content,overrides={})=>dto({sourcePath:'documents/scenes/translation.json',token:'prepared-translation',content,
  baseSourceRevision:`sha256:${sha(content)}`,sourceRevision:`sha256:${sha(content)}`,...overrides});
 const edit=(instanceIds=[ids[2],ids[0]],offset=[1.25,2,-.5])=>dto({instanceIds,offset});
 const patch=(content,instanceIds,offset)=>api.dispatchStudioCoreScene3DTranslationPatch(dto({protocolVersion:1,operation:'scene3d.translateObjects',content,instanceIds,offset}));
 const error=code=>failure=>failure?.errorCode===code;
 const replace=(content,path,token)=>{const range=api.locateJsonSource(api.parseJsonSource(content),path);assert.equal(range.exact,true);return content.slice(0,range.start)+token+content.slice(range.end);};
 function expected(content,selected,offset) {
  const original=JSON.parse(content.replace(/^\uFEFF/,'')),indexed=api.parseJsonSource(content),edits=[],paths=[];
  for(const[index,object]of original.objects.entries())if(selected.includes(object.instanceId))for(let axis=0;axis<3;axis++){
   const next=object.position[axis]+offset[axis];if(next===object.position[axis])continue;
   const path=`/objects/${index}/position/${axis}`,range=api.locateJsonSource(indexed,path);assert.equal(range.exact,true);edits.push({...plain(range),text:JSON.stringify(next)});paths.push(path);
  }
  let after=content;for(const range of edits.sort((a,b)=>b.start-a.start))after=after.slice(0,range.start)+range.text+after.slice(range.end);
  return{after,paths};
 }
 {
  let raw=text(value).replaceAll('"position"','"posi\\u0074ion"').replace('"objects"','"objec\\u0074s"').replace('1000','1.000e3');
  raw=replace(raw,'/objects/0/position/0','-0e0');raw=replace(raw,'/objects/2/position/0','1.500e0');
  for(const dirty of [false,true]){
   const content=raw+(dirty?' \r\n':''),source=snapshot(content,{baseSourceRevision:`sha256:${sha(raw)}`}),before=plain(source),input=edit(),p=api.createScene3DTranslationProposal(source,input),want=expected(content,[ids[0],ids[2]],[1.25,2,-.5]);
   assert.deepEqual(plain(p.instanceIds),[ids[0],ids[2]]);assert.equal(p.afterContent,want.after);assert.deepEqual(plain(p.changedPaths),want.paths);
   assert.deepEqual(plain(await api.prepareScene3DTranslationApply(source,p,{digest:sha})),{afterContent:p.afterContent,sourcePath:source.sourcePath,changedPaths:want.paths});
   const changed=JSON.parse(p.afterContent.slice(1));assert.deepEqual(changed.objects[1],value.objects[1]);assert.deepEqual(changed.camera,value.camera);assert.deepEqual(changed.light,value.light);assert.deepEqual(plain(source),before);
  }
  checks.push({id:'saved-dirty-sourceordered-atomic-translation-receipts-exact-BOM-CRLF-escaped-keys-and-position-only-token-splices',ok:true,modes:2});
 }
 {
  const large=structuredClone(value);large.objects=Array.from({length:128},(_,i)=>({...structuredClone(value.objects[0]),instanceId:`${i.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`,position:[i,0,0]}));
  const all=large.objects.map(object=>object.instanceId),source=snapshot(text(large)),p=api.createScene3DTranslationProposal(source,edit([...all].reverse(),[.5,0,0]));
  assert.deepEqual(plain(p.instanceIds),all);assert.equal(p.beforeObjects.length,128);assert.equal(p.afterObjects.length,128);assert.equal(p.changedPaths.length,128);assert.equal(p.changedPaths[127],'/objects/127/position/0');
  assert.deepEqual(plain(p.afterObjects).map(object=>object.position),large.objects.map(object=>[object.position[0]+.5,0,0]));await api.prepareScene3DTranslationApply(source,p,{digest:sha});
  checks.push({id:'all128-stable-targets-are-sourceordered-complete-diagnostics-with-one-native-batch-and-net-paths',ok:true,targets:128});
 }
 {
  const bounded=structuredClone(value);bounded.objects[0].position=[-100000,100000,0];bounded.objects[2].position=[-99999,100000,0];const raw=text(bounded),source=snapshot(raw),before=plain(source);
  for(const input of [edit([]),edit([ids[0],ids[0]]),edit(['ffffffff-ffff-ffff-ffff-ffffffffffff']),edit([ids[0],ids[2]],[200000,-200000,0]),edit([ids[0]],[200000.1,0,0])])assert.throws(()=>api.createScene3DTranslationProposal(source,input));
  assert.deepEqual(plain(source),before);const p=api.createScene3DTranslationProposal(source,edit([ids[0]],[200000,-200000,0]));assert.deepEqual(plain(p.afterObjects[0].position),[100000,-100000,0]);
  checks.push({id:'unknown-duplicate-empty-targets-and-one-overflow-refuse-entire-transaction-with-exact-offset-position-boundaries',ok:true});
 }
 {
  const partial=structuredClone(value);partial.objects[0].position=[100000,0,0];partial.objects[2].position=[0,0,0];let raw=text(partial);raw=replace(raw,'/objects/0/position/1','-0e0');raw=replace(raw,'/objects/0/position/0','1e5');
  assert.equal(patch(raw,[ids[2],ids[0]],[0,0,0]).afterContent,raw);assert.deepEqual(plain(patch(raw,[ids[0]],[5e-324,0,0]).changedPaths),[]);
  const source=snapshot(raw);assert.throws(()=>api.createScene3DTranslationProposal(source,edit([ids[0]],[5e-324,0,0])),error('scene3d_translation_unchanged'));
  assert.throws(()=>api.createScene3DTranslationProposal(source,edit([ids[0],ids[2]],[0,0,0])),error('scene3d_translation_unchanged'));
  const p=api.createScene3DTranslationProposal(source,edit([ids[2],ids[0]],[5e-324,0,0]));assert.deepEqual(plain(p.instanceIds),[ids[0],ids[2]]);assert.deepEqual(plain(p.changedPaths),['/objects/2/position/0']);assert.deepEqual(plain(p.beforeObjects[0]),plain(p.afterObjects[0]));
  await api.prepareScene3DTranslationApply(source,p,{digest:sha});checks.push({id:'native-zero-and-rounded-noops-preserve-lexemes-private-review-refuses-empty-change-and-partial-net-retains-all-targets',ok:true});
 }
 {
  let raw=text(value);raw+=' '.repeat(131072-new TextEncoder().encode(raw).length);const source=snapshot(raw);
  assert.equal(patch(raw,[ids[0]],[0,0,0]).afterContent,raw);assert.throws(()=>api.createScene3DTranslationProposal(source,edit([ids[0]],[.125,0,0])),error('scene3d_limit'));
  const p=api.createScene3DTranslationProposal(source,edit([ids[1]],[2,0,0]));assert.ok(new TextEncoder().encode(p.afterContent).length<131072);await api.prepareScene3DTranslationApply(source,p,{digest:sha});
  assert.throws(()=>patch(raw+' ',[ids[0]],[0,0,0]),error('scene3d_limit'));
  checks.push({id:'complete-original-final128KiB-budget-atomically-rejects-growth-and-accepts-shrink-or-byte-exact-noop',ok:true});
 }
 {
  const source=snapshot(text(value)),p=api.createScene3DTranslationProposal(source,edit()),cloned=dto(plain(p));
  assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.offset)&&Object.isFrozen(p.instanceIds)&&Object.isFrozen(p.afterObjects[0].position));assert.equal(api.isScene3DTranslationProposal(cloned),false);await assert.rejects(api.prepareScene3DTranslationApply(source,cloned,{digest:sha}),error('scene3d_translation_conflict'));
  const others=[api.createScene3DTransformProposal(source,dto({instanceId:ids[0],values:{position:[4,5,6]}})),api.createScene3DObjectsProposal(source,dto({action:'remove',instanceId:ids[0]})),api.createScene3DEnvironmentProposal(source,dto({values:{background:'#123456'}})),api.createScene3DPropertiesProposal(source,dto({instanceId:ids[0],values:{name:'Changed'}}))];
  for(const other of others){assert.equal(api.isScene3DTranslationProposal(other),false);await assert.rejects(api.prepareScene3DTranslationApply(source,other,{digest:sha}),error('scene3d_translation_conflict'));}
  for(const predicate of [api.isScene3DTransformProposal,api.isScene3DObjectsProposal,api.isScene3DEnvironmentProposal,api.isScene3DPropertiesProposal])assert.equal(predicate(p),false);
  checks.push({id:'private-deepfrozen-translation-brand-clones-and-all-four-foreign-authoring-brands-cannot-transfer-apply-authority',ok:true});
 }
 {
  const source=snapshot(text(value)),p=api.createScene3DTranslationProposal(source,edit());let release;
  const pending=api.prepareScene3DTranslationApply(source,p,{digest:async content=>{await new Promise(resolve=>{release=resolve;});return sha(content);}});
  source.content='late caller text';source.token='late caller token';release();assert.equal((await pending).afterContent,p.afterContent);
  for(const changes of [{sourcePath:'documents/other.json'},{token:'other-token'},{content:p.beforeContent+' '},{baseSourceRevision:`sha256:${'0'.repeat(64)}`},{sourceRevision:`sha256:${'1'.repeat(64)}`}])await assert.rejects(api.prepareScene3DTranslationApply(snapshot(p.beforeContent,changes),p,{digest:sha}),error('scene3d_translation_conflict'));
  await assert.rejects(api.prepareScene3DTranslationApply(snapshot(p.beforeContent),p,{digest:()=> '0'.repeat(64)}),error('scene3d_translation_conflict'));
  checks.push({id:'preawait-source-snapshot-and-complete-path-token-byte-two-revision-digest-conflicts-refuse-stale-apply',ok:true});
 }
 {
  assert.equal(api.supportsStudioCoreScene3DTranslationPatch(),true);const source=snapshot(text(value)),input=edit(),p=api.createScene3DTranslationProposal(source,input);input.offset[0]=999;input.instanceIds.reverse();assert.deepEqual(plain(p.offset),[1.25,2,-.5]);
  for(const changes of [{operation:'scene3d.patchObjectTransform'},{extra:true},{instanceIds:[ids[0],ids[0]]},{offset:[1,2]}])assert.throws(()=>api.dispatchStudioCoreScene3DTranslationPatch(dto({protocolVersion:1,operation:'scene3d.translateObjects',content:source.content,instanceIds:[ids[0]],offset:[1,0,0],...changes})),error('studio_core_request_invalid'));
  assert.equal(api.supportsStudioCoreScene3DPropertiesPatch(),true);assert.equal(api.supportsStudioCoreScene3DPatch(),true);assert.equal(api.supportsStudioCoreScene3DEnvironmentPatch(),true);assert.equal(api.supportsStudioCoreScene3DObjectsPatch(),true);assert.equal(api.getStudioCoreMetadata().ready,true);
  checks.push({id:'new-optional-domain-native-current-probe-binds-detached-intent-with-old-four-authoring-capabilities-independent',ok:true});
 }
 return checks;
}

async function portable(directory) {
  const context=vm.createContext({TextEncoder,TextDecoder,WebAssembly}),modules=new Map();
  function load(relative) {
    assert.equal(relative,path.posix.normalize(relative));
    assert.ok((relative.startsWith('engine/')&&relative.endsWith('.mjs')||['web/modules/scene3d-math.js','web/modules/scene3d-picking.js','web/modules/scene3d-renderer.js'].includes(relative)||relative.startsWith('vendor/yaml/')&&relative.endsWith('.js')||relative.startsWith('node_modules/yaml/browser/')&&relative.endsWith('.js'))&&!/[\\\0?#]/.test(relative));
    if(!modules.has(relative))modules.set(relative,fs.readFile(path.join(directory,relative),'utf8').then(source=>new vm.SourceTextModule(source,{context,identifier:relative})));return modules.get(relative);
  }
  function linker(specifier,ref) {
    if(specifier==='yaml')return load('node_modules/yaml/browser/index.js');
    assert.ok(typeof specifier==='string'&&!/[\\\0?#]/.test(specifier)&&(specifier.startsWith('./')||specifier.startsWith('../')||specifier.startsWith('/engine/')||['/web/modules/scene3d-math.js','/web/modules/scene3d-picking.js','/web/modules/scene3d-renderer.js'].includes(specifier)||specifier.startsWith('/vendor/yaml/')));
    return load(path.posix.normalize(specifier.startsWith('/')?specifier.slice(1):path.posix.join(path.posix.dirname(ref.identifier),specifier)));
  }
  const entry=new vm.SourceTextModule(moduleFiles.map(file=>`export * from '/${file}';`).join('\n'),{context,identifier:'portable-authoring-entry'});
  await entry.link(linker);await entry.evaluate();const wasm=await fs.readFile(path.join(directory,'engine/studio-core.wasm'));
  await entry.namespace.initializeStudioCore(async()=>wasm);assert.equal(entry.namespace.getStudioCoreMetadata().ready,true);
  assert.equal(vm.runInContext('[typeof process,typeof require,typeof Buffer,typeof document,typeof window,typeof fetch].join(",")',context),Array(6).fill('undefined').join(','));
  const realmJson=vm.runInContext('(text)=>JSON.parse(text)',context),api={...entry.namespace,realmJson,digest:sha};
  api.createSceneCompositionStructureDraft=async(model,source,options)=>{
    const draft=await entry.namespace.createSceneCompositionStructureDraft(realmJson(JSON.stringify(model)),realmJson(JSON.stringify(source)),options);
    return {...draft,propose:edit=>draft.propose(realmJson(JSON.stringify(edit)))};
  };
  api.prepareSceneCompositionStructureApply=(source,proposal,options)=>entry.namespace.prepareSceneCompositionStructureApply(realmJson(JSON.stringify(source)),realmJson(JSON.stringify(proposal)),options);
  api.createSceneCompositionPlacementsDraft=async(model,source,options)=>{
    const draft=await entry.namespace.createSceneCompositionPlacementsDraft(realmJson(JSON.stringify(model)),realmJson(JSON.stringify(source)),options);
    return {...draft,propose:edit=>draft.propose(realmJson(JSON.stringify(edit)))};
  };
  api.prepareSceneCompositionPlacementsApply=(source,proposal,options)=>entry.namespace.prepareSceneCompositionPlacementsApply(realmJson(JSON.stringify(source)),realmJson(JSON.stringify(proposal)),options);
  api.createSceneCompositionGroupsDraft=async(model,source,options)=>{
    const draft=await entry.namespace.createSceneCompositionGroupsDraft(realmJson(JSON.stringify(model)),realmJson(JSON.stringify(source)),options);
    return {...draft,propose:edit=>draft.propose(realmJson(JSON.stringify(edit)))};
  };
  api.prepareSceneCompositionGroupsApply=(source,proposal,options)=>entry.namespace.prepareSceneCompositionGroupsApply(realmJson(JSON.stringify(source)),realmJson(JSON.stringify(proposal)),options);
  api.createSceneCompositionDefinitionsDraft=async(model,source,options)=>{
    const draft=await entry.namespace.createSceneCompositionDefinitionsDraft(realmJson(JSON.stringify(model)),realmJson(JSON.stringify(source)),options);
    return {...draft,propose:edit=>draft.propose(realmJson(JSON.stringify(edit)))};
  };
  api.prepareSceneCompositionDefinitionsApply=(source,proposal,options)=>entry.namespace.prepareSceneCompositionDefinitionsApply(realmJson(JSON.stringify(source)),realmJson(JSON.stringify(proposal)),options);
  const checks={removal:await runRemovalCases(api),copy:await runCopyCases(api),distribution:await runDistributionCases(api),alignment:await runAlignmentCases(api),translation:await translationCases(api),selection:await selectionCases(api),picking:await pickingCases(api),navigation:await navigationCases(api),properties:await propertiesCases(api),environment:await environmentCases(api),objects:await objectsCases(api),transforms:await transformCases(api),scene3d:await runScene3DCases(api),rename:await runDefinitionRenameCases(api),definitions:await runDefinitionsCases(api),groups:await runGroupsCases(api),placements:await runPlacementsCases(api),system:await systemCases(api),workflow:await workflowCases(api),structure:await cases(api),legacy:[...await runPlacementCases(api,example),...await runInheritanceCases(api,example)],moduleCount:modules.size,
    wasmSha256:sha(wasm),noNodeDomNetworkGlobals:true,noHostImports:true,noDeviceAcceptance:true};
  assert.equal(sha(wasm),await fileSha(path.join(root,'engine/studio-core.wasm')));return checks;
}
report.portable.desktop=await portable(path.join(root,'desktop/resources'));
report.portable.mobile=await portable(path.join(root,'mobile/dist'));
for(const kind of ['removal','copy','distribution','alignment','translation','selection','picking','navigation','properties','environment','objects','transforms','scene3d','rename','definitions','groups','placements','system','workflow','structure','legacy'])assert.deepEqual(report.portable.desktop[kind],report.portable.mobile[kind]);
for(const [file,digest]of Object.entries(report.sourceHashes))assert.equal(await fileSha(path.join(root,file)),digest,file);
for(const [file,digest]of Object.entries(frozenSource))assert.equal(await fileSha(path.join(root,file)),digest,`Frozen source changed after verification: ${file}`);
for(const [file,digest]of Object.entries(historical))assert.equal(await fileSha(path.join(root,file)),digest,`Historical report changed after verification: ${file}`);
report.ok=true;report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(evidence,'packaged-resources.json'),json(report),{flag:'wx'});
console.log(JSON.stringify({ok:true,workflowCasesEach:report.portable.desktop.workflow.length,structureCasesEach:report.portable.desktop.structure.length,
  removalCasesEach:report.portable.desktop.removal.length,copyCasesEach:report.portable.desktop.copy.length,distributionCasesEach:report.portable.desktop.distribution.length,alignmentCasesEach:report.portable.desktop.alignment.length,translationCasesEach:report.portable.desktop.translation.length,selectionCasesEach:report.portable.desktop.selection.length,pickingCasesEach:report.portable.desktop.picking.length,navigationCasesEach:report.portable.desktop.navigation.length,propertiesCasesEach:report.portable.desktop.properties.length,environmentCasesEach:report.portable.desktop.environment.length,objectsCasesEach:report.portable.desktop.objects.length,transformCasesEach:report.portable.desktop.transforms.length,scene3dCasesEach:report.portable.desktop.scene3d.length,renameCasesEach:report.portable.desktop.rename.length,definitionsCasesEach:report.portable.desktop.definitions.length,legacyCasesEach:report.portable.desktop.legacy.length,groupsCasesEach:report.portable.desktop.groups.length,placementsCasesEach:report.portable.desktop.placements.length,systemCasesEach:report.portable.desktop.system.length,totalCases:2*(report.portable.desktop.removal.length+report.portable.desktop.copy.length+report.portable.desktop.distribution.length+report.portable.desktop.alignment.length+report.portable.desktop.translation.length+report.portable.desktop.selection.length+report.portable.desktop.picking.length+report.portable.desktop.navigation.length+report.portable.desktop.properties.length+report.portable.desktop.environment.length+report.portable.desktop.objects.length+report.portable.desktop.transforms.length+report.portable.desktop.scene3d.length+report.portable.desktop.rename.length+report.portable.desktop.definitions.length+report.portable.desktop.groups.length+report.portable.desktop.placements.length+report.portable.desktop.system.length+report.portable.desktop.workflow.length+report.portable.desktop.structure.length+report.portable.desktop.legacy.length),
  artifacts:Object.fromEntries(Object.entries(report.artifacts).map(([k,v])=>[k,v.manifestFileCount])),moduleCounts:{desktop:report.portable.desktop.moduleCount,mobile:report.portable.mobile.moduleCount}}));
