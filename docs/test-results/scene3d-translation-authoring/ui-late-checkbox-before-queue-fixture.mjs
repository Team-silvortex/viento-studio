import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from '../../../scripts/tests/dialog-harness.mjs';
import { initializeStudioCore, supportsStudioCoreScene3DTranslationPatch } from '../../../engine/studio-core.mjs';
import { parseScene3DSource } from '../../../engine/scene3d.mjs';
import { createScene3DTranslationProposal, isScene3DTranslationProposal } from '../../../engine/scene3d-translation.mjs';
const root=new URL('../../../',import.meta.url),out=new URL('./',import.meta.url),sha=v=>createHash('sha256').update(v).digest('hex');
await initializeStudioCore(()=>fs.readFile(new URL('engine/studio-core.wasm',root)));
const content=await fs.readFile(new URL('examples/scene3d/scene.json',root),'utf8');
const context={editable:true,creating:false,busy:false,sourceJSON:true,sourcePath:'documents/scene.json',sourceToken:'session:1'};
const h=await dialogHarness('app-scene3d-translation',{parseScene3DSource,createScene3DTranslationProposal,isScene3DTranslationProposal,supportsStudioCoreScene3DTranslationPatch,
 t:v=>v,translatePage(){},onLanguageChange(){return()=>{};}});
h.runtime.window.confirm=()=>true;
const controller=h.runtime.setupScene3DTranslation({getContext:()=>context,getSource:async()=>({content,sourcePath:context.sourcePath,token:context.sourceToken,baseSourceRevision:'sha256:'+sha(content),sourceRevision:'sha256:'+sha(content)}),applyDraft:async()=>{throw Error('No apply authorized by this probe');}});
await controller.open();await flushDialogs();
const dialog=h.element('scene3dTranslationDialog'),list=h.element('scene3dTranslationObjects');
const old=list.querySelectorAll('input[type=checkbox]')[0];
controller.close(true);context.sourceToken='session:2';await controller.open();await flushDialogs();
const before=h.element('scene3dTranslationSelection').textContent;
old.checked=true;old.dispatch('change');
const after=h.element('scene3dTranslationSelection').textContent;
const changed=before!==after;
const report={format:'viento-scene3d-translation-ui-late-checkbox-quality',node:process.version,before,after,oldElementConnected:old.isConnected,
 oldId:old.dataset.instanceId,dialogOpen:dialog.open,ok:!changed,scope:'Actual controller in event-capable DOM fixture with real native parse/proposal dependencies. Only a detached previous-session checkbox change is dispatched; no Check/Apply/Save/source mutation occurs.'};
await fs.writeFile(new URL('ui-late-checkbox-initial.json',out),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));controller.dispose();process.exitCode=changed?1:0;
