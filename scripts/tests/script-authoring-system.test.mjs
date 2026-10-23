import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createStudioModuleRegistry} from '../../engine/studio-modules.mjs';
const source=await fs.readFile(new URL('../../web/modules/app-studio-system.js',import.meta.url),'utf8'),copy=x=>JSON.parse(JSON.stringify(x));
function harness(){const registry=createStudioModuleRegistry(),mounts=[],editMounts=[],usageMounts=[];let refreshed=0,editRefreshed=0,usageRefreshed=0;
 const bindings={createStudioModuleRegistry:()=>({plan:(p,o)=>registry.plan(copy(p),copy(o))}),setupSettings:async()=>{},setupScriptUsage:ports=>{usageMounts.push(ports);return{refresh:()=>usageRefreshed++};},setupAnimationStateScriptEdit:ports=>{editMounts.push(ports);return{refresh:()=>editRefreshed++};},setupScriptCreate:ports=>{mounts.push(ports);return{refresh:()=>refreshed++};}};
 for(const name of ['setupWorldBrowser','setupProjectBuild','setupProjectSettings','setupExport','setupMediaEditor'])bindings[name]=()=>({setAvailable(){}});
 const context=vm.createContext(bindings);vm.runInContext(source.replace(/^import[^\n]*\n/gm,'').replace('export async function','async function'),context);
 return{setup:o=>context.setupStudioSystem(o),mounts,editMounts,usageMounts,get usageRefreshed(){return usageRefreshed;},get refreshed(){return refreshed;},get editRefreshed(){return editRefreshed;}};
}
test('script starter has independent frozen source ports and works without build or behavior services',async()=>{
 const h=harness(),ports={getContext(){},createDraft(){}},system=await h.setup({ports:{scripts:ports}});assert.equal(h.mounts.length,1);assert.ok(Object.isFrozen(h.mounts[0]));assert.equal(h.mounts[0].createDraft,ports.createDraft);assert.deepEqual(Object.keys(h.mounts[0]).sort(),Object.keys(ports).sort());
 const snap=system.snapshot();assert.equal(snap.hostCapabilities.projectBuild,false);assert.ok(snap.initializedModules.includes('org.viento.scripts'));assert.equal(snap.plan.capabilities.find(c=>c.capability==='authoring.script').active,true);system.refreshMedia();assert.equal(h.refreshed,1);
});
test('a declarative requirement cannot activate script creation when ports are absent or feature is disabled',async()=>{
 for(const options of [{},{ports:{scripts:{}},features:{scripts:false}}]){const h=harness(),system=await h.setup(options);const s=system.updateProject({studioProfile:{format:'viento-studio-profile',schemaVersion:1,required:[{capability:'authoring.script',apiVersion:1}],optional:[]}});assert.equal(h.mounts.length,0);assert.equal(s.plan.requests[0].status,'inactive');assert.equal(typeof system.createDraft,'undefined');}
});


test('state-table editing shares one script module but receives only its own immutable ports',async()=>{
 const h=harness(),edit={getContext(){},getSource(){},applyDraft(){}},creation={getContext(){},createDraft(){},editStateTable:edit};
 const system=await h.setup({ports:{scripts:creation}});
 assert.equal(h.mounts.length,1);assert.equal(h.editMounts.length,1);assert.ok(Object.isFrozen(h.editMounts[0]));
 assert.deepEqual(Object.keys(h.mounts[0]).sort(),['createDraft','getContext']);assert.deepEqual(Object.keys(h.editMounts[0]).sort(),['applyDraft','getContext','getSource']);
 assert.equal(h.editMounts[0].getContext,edit.getContext);assert.equal(h.mounts[0].getContext,creation.getContext);
 const snapshot=system.snapshot();assert.equal(snapshot.initializedModules.filter(id=>id==='org.viento.scripts').length,1);
 system.refreshMedia();assert.equal(h.refreshed,1);assert.equal(h.editRefreshed,1);
 const saved=h.editMounts[0].getSource;edit.getSource=()=>null;assert.equal(h.editMounts[0].getSource,saved);
});
test('disabled script module mounts neither creation nor the state-table editor',async()=>{
 const h=harness();await h.setup({features:{scripts:false},ports:{scripts:{editStateTable:{getSource(){}}}}});
 assert.equal(h.mounts.length,0);assert.equal(h.editMounts.length,0);
});


test('script usage receives isolated read and navigation ports within the existing scripts module',async()=>{
 const h=harness(),usage={getContext(){},getSource(){},getUsage(){},openSource(){}},edit={getContext(){},getSource(){},applyDraft(){}};
 const creation={getContext(){},createDraft(){},editStateTable:edit,usage};const system=await h.setup({ports:{scripts:creation}});
 assert.equal(h.usageMounts.length,1);assert.ok(Object.isFrozen(h.usageMounts[0]));
 assert.deepEqual(Object.keys(h.mounts[0]).sort(),['createDraft','getContext']);assert.deepEqual(Object.keys(h.editMounts[0]).sort(),['applyDraft','getContext','getSource']);
 assert.deepEqual(Object.keys(h.usageMounts[0]).sort(),['getContext','getSource','getUsage','openSource']);assert.equal(h.usageMounts[0].getContext,usage.getContext);
 assert.equal(system.snapshot().initializedModules.filter(id=>id==='org.viento.scripts').length,1);system.refreshMedia();assert.equal(h.refreshed,1);assert.equal(h.editRefreshed,1);assert.equal(h.usageRefreshed,1);
 const original=h.usageMounts[0].openSource;usage.openSource=()=>false;assert.equal(h.usageMounts[0].openSource,original);
});
test('script usage stays optional and the script feature switch disables all three tools',async()=>{
 const absent=harness();await absent.setup({ports:{scripts:{createDraft(){}}}});assert.equal(absent.usageMounts.length,0);
 const disabled=harness();await disabled.setup({features:{scripts:false},ports:{scripts:{usage:{getUsage(){}}}}});assert.equal(disabled.mounts.length,0);assert.equal(disabled.usageMounts.length,0);
});
