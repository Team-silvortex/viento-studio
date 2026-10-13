import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';
const source=await fs.readFile(new URL('../../web/modules/app-studio-system.js',import.meta.url),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(){const registry=createStudioModuleRegistry(),mounts=[];let refreshed=0;
 const bindings={createStudioModuleRegistry:()=>({plan:(p,o)=>registry.plan(copy(p),copy(o))}),setupSettings:async()=>{},setupSceneBehaviors:ports=>{mounts.push(ports);return{refresh:()=>refreshed++};}};
 for(const name of ['setupWorldBrowser','setupProjectBuild','setupProjectSettings','setupExport','setupMediaEditor'])bindings[name]=()=>({setAvailable(){}});
 const context=vm.createContext(bindings);vm.runInContext(source.replace(/^import[^\n]*\n/gm,'').replace('export async function','async function'),context);
 return{setup:options=>context.setupStudioSystem(options),mounts,get refreshed(){return refreshed;}};
}
test('behavior editor mounts with its own source ports independently of scene preview and execution',async()=>{
 const h=fixture(),ports={getContext(){},getSource(){},inspect(){},applyDraft(){}},system=await h.setup({ports:{sceneBehaviors:ports}});
 assert.equal(h.mounts.length,1);assert.ok(Object.isFrozen(h.mounts[0]));assert.equal(h.mounts[0].applyDraft,ports.applyDraft);assert.deepEqual(Object.keys(h.mounts[0]).sort(),Object.keys(ports).sort());
 const snap=system.snapshot();assert.ok(snap.initializedModules.includes('org.viento.scene-behaviors'));assert.equal(snap.hostCapabilities.projectBuild,false);
 assert.equal(snap.plan.capabilities.find(c=>c.capability==='scene.authoring.behaviors').active,true);system.refreshMedia();assert.equal(h.refreshed,1);
});
test('disabled or missing behavior ports cannot mount via a declarative project request',async()=>{
 for(const options of [{},{features:{sceneBehaviors:false},ports:{sceneBehaviors:{}}}]){const h=fixture(),system=await h.setup(options);
 const snapshot=system.updateProject({studioProfile:{format:'viento-studio-profile',schemaVersion:1,required:[{capability:'scene.authoring.behaviors',apiVersion:1}],optional:[]}});
 assert.equal(h.mounts.length,0);assert.equal(snapshot.plan.requests[0].status,'inactive');assert.equal(typeof system.applyDraft,'undefined');}
});
