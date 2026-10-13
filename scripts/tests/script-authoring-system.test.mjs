import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createStudioModuleRegistry} from '../../engine/studio-modules.mjs';
const source=await fs.readFile(new URL('../../web/modules/app-studio-system.js',import.meta.url),'utf8'),copy=x=>JSON.parse(JSON.stringify(x));
function harness(){const registry=createStudioModuleRegistry(),mounts=[];let refreshed=0;
 const bindings={createStudioModuleRegistry:()=>({plan:(p,o)=>registry.plan(copy(p),copy(o))}),setupSettings:async()=>{},setupScriptCreate:ports=>{mounts.push(ports);return{refresh:()=>refreshed++};}};
 for(const name of ['setupWorldBrowser','setupProjectBuild','setupProjectSettings','setupExport','setupMediaEditor'])bindings[name]=()=>({setAvailable(){}});
 const context=vm.createContext(bindings);vm.runInContext(source.replace(/^import[^\n]*\n/gm,'').replace('export async function','async function'),context);
 return{setup:o=>context.setupStudioSystem(o),mounts,get refreshed(){return refreshed;}};
}
test('script starter has independent frozen source ports and works without build or behavior services',async()=>{
 const h=harness(),ports={getContext(){},createDraft(){}},system=await h.setup({ports:{scripts:ports}});assert.equal(h.mounts.length,1);assert.ok(Object.isFrozen(h.mounts[0]));assert.equal(h.mounts[0].createDraft,ports.createDraft);assert.deepEqual(Object.keys(h.mounts[0]).sort(),Object.keys(ports).sort());
 const snap=system.snapshot();assert.equal(snap.hostCapabilities.projectBuild,false);assert.ok(snap.initializedModules.includes('org.viento.scripts'));assert.equal(snap.plan.capabilities.find(c=>c.capability==='authoring.script').active,true);system.refreshMedia();assert.equal(h.refreshed,1);
});
test('a declarative requirement cannot activate script creation when ports are absent or feature is disabled',async()=>{
 for(const options of [{},{ports:{scripts:{}},features:{scripts:false}}]){const h=harness(),system=await h.setup(options);const s=system.updateProject({studioProfile:{format:'viento-studio-profile',schemaVersion:1,required:[{capability:'authoring.script',apiVersion:1}],optional:[]}});assert.equal(h.mounts.length,0);assert.equal(s.plan.requests[0].status,'inactive');assert.equal(typeof system.createDraft,'undefined');}
});
