import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {serve} from './helpers.mjs';
const appRoot=fileURLToPath(new URL('../../',import.meta.url)),route='/api/scene-behavior-creation',sceneObjectId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
async function fixture(t,mode='doc-site-server.mjs'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'viento-behavior-create-http-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp(path.join(appRoot,'examples/scene-behaviors'),root,{recursive:true});
 const metadata=path.join(root,`metadata/documents/${sceneObjectId}.json`),record=JSON.parse(await fs.readFile(metadata,'utf8'));record.relations=record.relations.filter(r=>r.kind!=='behavior');await fs.writeFile(metadata,JSON.stringify(record));
 const base=await serve(t,appRoot,{VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:root,DOC_API_TOKEN:'creation-test-token',DOC_API_REQUIRE_WRITE_AUTH:'1'},mode);
 return{base,root,post:(value={sceneObjectId},auth=true,suffix='')=>fetch(base+route+suffix,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer creation-test-token'}:{})},body:JSON.stringify(value)})};
}
test('creation catalog requires author authentication, returns no-store context and exposes engine-independent command capability',async t=>{
 const h=await fixture(t),cap=await fetch(h.base+'/api/capabilities').then(r=>r.json());assert.ok((cap.data||cap).semanticCommands.includes('behavior.create'));
 assert.equal((await h.post(undefined,false)).status,401);const response=await h.post();assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);const body=await response.json(),value=body.data||body;assert.equal(value.format,'viento-behavior-creation-context');assert.equal(value.scene.instances.length,2);assert.equal(JSON.stringify(value).includes(h.root),false);
 assert.equal((await h.post({sceneObjectId,execute:true})).status,400);assert.equal((await h.post(undefined,true,'?path=x')).status,400);assert.equal((await fetch(h.base+route)).status,405);
});
test('browse service refuses the first-creation catalog',async t=>{const h=await fixture(t,'browse-server.mjs');assert.equal((await h.post()).status,405);});
