import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';
const source=await fs.readFile(new URL('../../web/modules/app-studio-system.js',import.meta.url),'utf8'),copy=x=>JSON.parse(JSON.stringify(x));
function harness(){const registry=createStudioModuleRegistry(),mounts=[],availability=[];let refreshed=0;
 const bindings={createStudioModuleRegistry:()=>({plan:(p,o)=>registry.plan(copy(p),copy(o))}),setupSettings:async()=>{},
 setupSceneCompositionCreate:ports=>{mounts.push(ports);return{refresh:()=>refreshed++,setAvailable:value=>availability.push(value)};}};
 for(const name of ['setupWorldBrowser','setupProjectBuild','setupProjectSettings','setupExport','setupMediaEditor'])bindings[name]=()=>({setAvailable(){}});
 const context=vm.createContext(bindings);vm.runInContext(source.replace(/^import[^\n]*\n/gm,'').replace('export async function','async function'),context);
 return{setup:o=>context.setupStudioSystem(o),mounts,availability,get refreshed(){return refreshed;}};
}
test('composition creation has independent frozen ports and needs query capability rather than build or command rights',async()=>{
 const h=harness(),ports={getContext(){},createDraft(){}},system=await h.setup({ports:{compositionCreate:ports},features:{build:false}});
 assert.equal(h.mounts.length,1);assert.ok(Object.isFrozen(h.mounts[0]));assert.equal(h.mounts[0].createDraft,ports.createDraft);
 system.updateCapabilities({semanticProjection:true,semanticCommands:[],projectBuild:false});assert.equal(h.availability.at(-1),true);
 const snapshot=system.snapshot();assert.ok(snapshot.initializedModules.includes('org.viento.scene-composition-create'));
 assert.equal(snapshot.plan.capabilities.find(c=>c.capability==='scene.authoring.composition-create').domain,'authoring');system.refreshMedia();assert.equal(h.refreshed,1);
 system.updateCapabilities({semanticProjection:false,projectBuild:true});assert.equal(h.availability.at(-1),false);
 assert.equal(typeof system.createDraft,'undefined');
});
test('project requirements cannot activate absent or disabled composition creation ports',async()=>{
 for(const options of [{},{ports:{compositionCreate:{}},features:{compositionCreate:false}}]){
  const h=harness(),system=await h.setup(options),snapshot=system.updateProject({studioProfile:{format:'viento-studio-profile',schemaVersion:1,required:[{capability:'scene.authoring.composition-create',apiVersion:1}],optional:[]}});
  assert.equal(h.mounts.length,0);assert.equal(snapshot.plan.requests[0].status,'inactive');
 }
});
