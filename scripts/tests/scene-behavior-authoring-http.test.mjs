import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {serve} from './helpers.mjs';
const appRoot=fileURLToPath(new URL('../../',import.meta.url)),route='/api/scene-behavior-authoring';
async function fixture(t,mode='doc-site-server.mjs'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'viento-behavior-author-http-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.cp(path.join(appRoot,'examples/scene-behaviors'),root,{recursive:true});
 const base=await serve(t,appRoot,{VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:root,DOC_API_TOKEN:'behavior-test-token',DOC_API_REQUIRE_WRITE_AUTH:'1'},mode);
 const content=await fs.readFile(path.join(root,'documents/behaviors/demo.json'),'utf8');
 return{base,root,content,payload:{sourcePath:'documents/behaviors/demo.json',content},post:(value,auth=true,suffix='')=>fetch(base+route+suffix,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer behavior-test-token'}:{})},body:JSON.stringify(value)})};
}
test('behavior authoring HTTP is advertised independently of engines and requires editor write authentication',async t=>{
 const h=await fixture(t);const cap=await fetch(h.base+'/api/capabilities').then(r=>r.json());assert.equal((cap.data||cap).sceneBehaviorAuthoring,true);
 assert.equal((await h.post(h.payload,false)).status,401);
 const response=await h.post(h.payload);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/(?:^|,\s*)no-store(?:,|$)/);
 const raw=await response.json(),value=raw.data||raw;assert.equal(value.format,'viento-behavior-authoring-context');assert.equal(value.scene.instances.length,2);assert.equal(value.sources.length,1);
 assert.equal(JSON.stringify(value).includes(h.root),false);
 assert.equal((await h.post({...h.payload,execute:true})).status,400);assert.equal((await h.post(h.payload,true,'?path=elsewhere')).status,400);
 assert.equal((await fetch(h.base+route)).status,405);
 assert.equal(await fs.readFile(path.join(h.root,h.payload.sourcePath),'utf8'),h.content);
});
test('behavior HTTP dependency revision changes with saved source edits and never saves the candidate',async t=>{
 const h=await fixture(t);const inspect=async payload=>{const r=await h.post(payload);assert.equal(r.status,200);const b=await r.json();return b.data||b;};
 const before=await inspect(h.payload),value=JSON.parse(h.content);value.bindings[0].parameters.amount=63;
 const reviewed=await inspect({...h.payload,content:JSON.stringify(value)});assert.equal(reviewed.dependencyRevision,before.dependencyRevision);
 await fs.appendFile(path.join(h.root,'documents/scripts/checkpoint.txt'),'\n# External source edit\n');
 const changed=await inspect(h.payload);assert.notEqual(changed.dependencyRevision,before.dependencyRevision);
 assert.equal(await fs.readFile(path.join(h.root,h.payload.sourcePath),'utf8'),h.content);
});
test('read-only browse service cannot offer the authoring inspector',async t=>{
 const h=await fixture(t,'browse-server.mjs');const result=await h.post(h.payload);assert.equal(result.status,405);
 const response=await fetch(h.base+'/api/capabilities');if(response.ok){const data=await response.json();assert.notEqual((data.data||data).sceneBehaviorAuthoring,true);}
});
