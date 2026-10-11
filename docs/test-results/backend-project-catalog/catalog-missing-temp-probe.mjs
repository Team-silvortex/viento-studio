import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { backendProjectFixture } from '../../../scripts/tests/helpers/backend-project-fixture.mjs';
import { createProjectRetentionPin, pinProjectFile } from '../../../scripts/adapters/node-backend-project-retention.mjs';
import { createBackendProjectCatalog, BACKEND_PROJECT_CATALOG_FILE } from '../../../scripts/adapters/node-backend-project-catalog.mjs';
import { fileURLToPath } from 'node:url';

const backendId = 'org.viento.godot4';
const createdAt = '2026-10-11T08:00:00.000Z';
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-catalog-boundary-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const namespace = path.join(base, 'cache/editor', 'a'.repeat(24), backendId);
  await fs.mkdir(namespace, { recursive: true });
  const options = { namespace, backendId }, catalog = createBackendProjectCatalog(options);
  async function output(owner = catalog) {
    // The existing fixture materializes real frozen host/generator bytes;
    // its tool identity is descriptive and no engine process is started.
    const built = await backendProjectFixture(t);
    const directory = path.join(namespace, randomUUID()); await fs.mkdir(directory);
    const pin = await createProjectRetentionPin(directory);
    await fs.cp(built.directory, directory, { recursive: true });
    for (const item of await fs.readdir(directory, { recursive: true, withFileTypes: true })) if (item.isFile()) {
      const file = path.join(item.parentPath, item.name), relative = path.relative(directory, file).split(path.sep).join('/');
      pinProjectFile(pin, relative, await fs.readFile(file));
    }
    const args = { buildDirectory: directory, project: built.project, manifestSha256: built.manifestSha256,
      title: 'Independent recovery fixture', createdAt, retentionPin: pin };
    const entry = await owner.capture(args);
    return { ...built, directory, pin, args, entry };
  }
  return { base, namespace, options, catalog, output, index: path.join(namespace, BACKEND_PROJECT_CATALOG_FILE) };
}


const outputName=process.argv[2];
assert.ok(['catalog-missing-temp-initial.json','catalog-missing-temp-final.json'].includes(outputName));
assert.equal(process.version,'v24.20.0');
const cleanup=[];
const t={after(action){cleanup.push(action);}};
const report={schemaVersion:1,node:process.version,scope:'Only source catalog publication fault injection in disposable host/generator fixtures; no actual engine process or installation.',startedAt:new Date().toISOString()};
try {
 const h=await fixture(t),first=await h.output(),second=await h.output();
 await h.catalog.upsert(first.entry);
 const indexBefore=await fs.readFile(h.index),originalOpen=fs.open;
 let removed=0;
 fs.open=async(file,flags,...rest)=>{
   const handle=await originalOpen(file,flags,...rest);
   if(typeof file==='string' && path.dirname(file)===h.namespace && /^\.backend-project-catalog-[a-f0-9-]+\.tmp$/.test(path.basename(file)) && flags & constants.O_EXCL){
     const close=handle.close.bind(handle);
     handle.close=async()=>{const result=await close();if(removed++===0)await fs.unlink(file);return result;};
   }return handle;
 };
 try {await h.catalog.upsert(second.entry);assert.fail('Disappeared temp must reject.');}
 catch(error){report.firstError=error.errorCode||error.code;}
 finally{fs.open=originalOpen;}
 assert.equal(removed,1);assert.deepEqual(await fs.readFile(h.index),indexBefore);
 report.originalIndexPreserved=true;
 const lock=path.join(h.namespace,'.backend-project-catalog.lock');
 report.ownedLockLeftBehind=await fs.lstat(lock).then(()=>true,error=>{assert.equal(error.code,'ENOENT');return false;});
 try {await h.catalog.upsert(second.entry);report.nextUpsertSucceeded=true;}
 catch(error){report.nextUpsertSucceeded=false;report.nextError=error.errorCode||error.code;}
 report.sourceSha256=createHash('sha256').update(await fs.readFile(new URL('../../../scripts/adapters/node-backend-project-catalog.mjs',import.meta.url))).digest('hex');
 report.ok=!report.ownedLockLeftBehind && report.nextUpsertSucceeded;
 if(outputName.endsWith('-final.json'))assert.equal(report.ok,true,'Own lock must release after temporary cleanup failure.');
 report.finishedAt=new Date().toISOString();
 await fs.writeFile(new URL(outputName,import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(report));
} finally {for(const action of cleanup.reverse())await action();}
