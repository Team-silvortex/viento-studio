import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createBackendProjectCatalog, assertCatalogProject, BACKEND_PROJECT_CATALOG_FILE } from '../adapters/node-backend-project-catalog.mjs';
import { createProjectRetentionPin, pinProjectFile, PROJECT_RETENTION_PIN } from '../adapters/node-backend-project-retention.mjs';
import { backendProjectFixture, json } from './helpers/backend-project-fixture.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = { errorCode: 'backend_project_catalog_invalid' };
const changed = { errorCode: 'backend_project_catalog_changed' };

async function fixture(t, options = {}) {
  const f = await backendProjectFixture(t, options);
  const backendId = f.project.backend.id, namespace = path.join(f.temporary, 'cache', 'editor', 'a'.repeat(24), backendId);
  const directory = path.join(namespace, randomUUID()); await fs.mkdir(namespace, { recursive: true }); await fs.rename(f.directory, directory);
  const pin = await createProjectRetentionPin(directory); pinProjectFile(pin, 'backend-project.json', json(f.project));
  const catalog = createBackendProjectCatalog({ namespace, backendId });
  const capture = { buildDirectory: directory, project: f.project, manifestSha256: f.manifestSha256, title: '<scene & source>',
    createdAt: '2026-10-11T00:00:00.000Z', retentionPin: pin };
  return { ...f, backendId, namespace, directory, pin, catalog, capture };
}
async function seed(f, index) {
  const project = structuredClone(f.project); project.buildId = randomUUID();
  const directory = path.join(f.namespace, randomUUID()); await fs.mkdir(directory);
  const bytes = json(project); await fs.writeFile(path.join(directory, 'backend-project.json'), bytes);
  const pin = await createProjectRetentionPin(directory); pinProjectFile(pin, 'backend-project.json', bytes);
  return { buildDirectory: directory, project, manifestSha256: sha(bytes), title: `Scene ${index}`,
    createdAt: new Date(Date.UTC(2026, 9, 11, 0, 0, index)).toISOString(), retentionPin: pin };
}

test('host catalog records successful creation and restores detached preserved-only receipts without author or tool access', async t => {
  for (const backend of ['godot', 'bevy']) {
    const f = await fixture(t, { backend }), entry = await f.catalog.capture(f.capture);
    assert.equal(Object.isFrozen(entry), true); assert.equal(Object.isFrozen(entry.physical), true);
    assert.equal(Object.hasOwn(entry, PROJECT_RETENTION_PIN), false); assert.equal(Object.hasOwn(entry, 'files'), false);
    const saved = await f.catalog.upsert(entry);
    assert.deepEqual(Object.keys(saved), ['format', 'schemaVersion', 'namespaceSha256', 'backendId', 'entries']);
    assert.equal(saved.entries[0].buildId, f.build.buildId); assert.equal(saved.namespaceSha256, `sha256:${sha(f.namespace)}`);
    await fs.rm(f.author, { recursive: true });
    const restarted = createBackendProjectCatalog({ namespace: f.namespace, backendId: f.backendId });
    const recovered = (await restarted.read()).entries[0];
    assert.deepEqual(recovered, entry); assert.notEqual(recovered, entry);
    assert.deepEqual(await assertCatalogProject(recovered), { buildDirectory: f.directory, expectedBuildId: entry.buildId,
      expectedSnapshotId: entry.snapshotId, expectedManifestSha256: entry.manifestSha256 });
    await assert.rejects(restarted.upsert(entry), invalid);
    assert.equal(JSON.stringify(recovered).includes(f.author), false);
  }
});

test('empty reads neither create the namespace nor enumerate and adopt foreign directory contents', async t => {
  const f = await fixture(t), entry = await f.catalog.capture(f.capture);
  const absent = path.join(f.temporary, 'empty', 'editor', 'b'.repeat(24), f.backendId), catalog = createBackendProjectCatalog({ namespace: absent, backendId: f.backendId });
  assert.deepEqual((await catalog.read()).entries, []); await assert.rejects(fs.stat(absent), { code: 'ENOENT' });
  const existing = await f.catalog.read(); assert.deepEqual(existing.entries, []);
  await fs.mkdir(path.join(f.namespace, 'foreign-output'));
  assert.deepEqual((await f.catalog.read()).entries, []);
  await f.catalog.upsert(entry); assert.equal((await f.catalog.read()).entries.length, 1);
});

test('snapshot admission rejects accessors foreign scopes raw entries and malformed metadata before performing IO', async t => {
  const f = await fixture(t); let reads = 0;
  const options = { namespace: f.namespace, backendId: f.backendId };
  Object.defineProperty(options, 'namespace', { enumerable: true, get() { reads++; return f.namespace; } });
  assert.throws(() => createBackendProjectCatalog(options), invalid); assert.equal(reads, 0);
  for (const options of [{ namespace:f.namespace,backendId:f.backendId,extra:true }, { namespace:f.namespace+'/..',backendId:f.backendId },
    { namespace:f.namespace,backendId:'org.viento.foreign' }]) assert.throws(() => createBackendProjectCatalog(options), invalid);
  const entry = await f.catalog.capture(f.capture);
  await assert.rejects(assertCatalogProject(structuredClone(entry)), invalid); await assert.rejects(f.catalog.upsert(structuredClone(entry)), invalid);
  await assert.rejects(f.catalog.remove('../outside'), invalid);
  for (const change of [x => { x.extra=true; }, x => { x.manifestSha256='0'.repeat(64); }, x => { x.createdAt='not time'; },
    x => { x.title='x'.repeat(161); }, x => { x.project=structuredClone(x.project);x.project.backend.id='org.viento.foreign'; }]) {
    const input={...f.capture};change(input);await assert.rejects(f.catalog.capture(input));
  }
  const input={...f.capture};Object.defineProperty(input,'title',{enumerable:true,get(){reads++;return 'bad';}});
  await assert.rejects(f.catalog.capture(input),invalid);assert.equal(reads,0);
  await assert.rejects(fs.stat(path.join(f.namespace,BACKEND_PROJECT_CATALOG_FILE)),{code:'ENOENT'});
});

test('capture snapshots mutable source before await and requires the creating directory and manifest ledger', async t => {
  const f=await fixture(t), input={...f.capture,project:structuredClone(f.project)};
  const pending=f.catalog.capture(input);input.project.source.sceneId=randomUUID();input.title='changed';
  const entry=await pending;assert.equal(entry.sceneId,f.project.source.sceneId);assert.equal(entry.title,f.capture.title);
  const wrong={...f.capture,retentionPin:{...f.pin,files:new Map()}};await assert.rejects(f.catalog.capture(wrong),invalid);
  const manifest=path.join(f.directory,'backend-project.json');await fs.appendFile(manifest,' ');
  await assert.rejects(f.catalog.capture(f.capture),{errorCode:'backend_project_changed'});
  await assert.rejects(f.catalog.upsert(entry),{errorCode:'backend_project_changed'});
});

test('atomic locked updates from independent catalog objects keep both entries and remove only the selected identity', async t => {
  const f=await fixture(t), second=createBackendProjectCatalog({namespace:f.namespace,backendId:f.backendId});
  const a=await f.catalog.capture(f.capture), b=await second.capture(await seed(f,2));
  await Promise.all([f.catalog.upsert(a),second.upsert(b)]);
  const saved=await f.catalog.read();assert.equal(saved.entries.length,2);assert.deepEqual(saved.entries.map(x=>x.buildId).sort(),[a.buildId,b.buildId].sort());
  await second.remove(a.buildId);assert.deepEqual((await f.catalog.read()).entries.map(x=>x.buildId),[b.buildId]);
  assert.equal((await fs.stat(f.directory)).isDirectory(),true);
  await second.remove(randomUUID());assert.equal((await f.catalog.read()).entries.length,1);
});

test('cross-process writers serialize atomic read-modify-write instead of losing earlier registered entries', async t => {
  const f=await fixture(t), inputs=[f.capture,await seed(f,1),await seed(f,2)];
  const moduleUrl=new URL('../adapters/node-backend-project-catalog.mjs',import.meta.url).href;
  const worker=`import fs from 'node:fs/promises';import {createBackendProjectCatalog} from ${JSON.stringify(moduleUrl)};
    const p=JSON.parse(process.env.VIENTO_CATALOG_TEST_INPUT), stat=await fs.lstat(p.input.buildDirectory);
    p.input.retentionPin={directory:p.input.buildDirectory,dev:stat.dev,ino:stat.ino,files:new Map([['backend-project.json',{size:0,sha256:p.input.manifestSha256}]])};
    const c=createBackendProjectCatalog(p.options);await c.upsert(await c.capture(p.input));`;
  await Promise.all(inputs.map(input=>new Promise((resolve,reject)=>{
    const {retentionPin,...serial}=input;const child=spawn(process.execPath,['--input-type=module','-e',worker],{env:{...process.env,
      VIENTO_CATALOG_TEST_INPUT:JSON.stringify({options:{namespace:f.namespace,backendId:f.backendId},input:serial})},stdio:['ignore','pipe','pipe']});
    let output='';child.stderr.on('data',bytes=>{output+=bytes;});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(output)));
  })));
  assert.equal((await f.catalog.read()).entries.length,3);
});

test('corrupt mismatched and oversized indices fail closed and retain every original byte', async t => {
  const f=await fixture(t), entry=await f.catalog.capture(f.capture);await f.catalog.upsert(entry);
  const target=path.join(f.namespace,BACKEND_PROJECT_CATALOG_FILE), valid=await fs.readFile(target);
  for(const bytes of [Buffer.from('{'),Buffer.from('{"format":"other"}'),Buffer.from([0xff]),Buffer.alloc(1024*1024+1,32)]) {
    await fs.writeFile(target,bytes);await assert.rejects(f.catalog.read());await assert.rejects(f.catalog.upsert(entry));
    assert.deepEqual(await fs.readFile(target),bytes);
  }
  for(const change of [x=>{x.backendId='org.viento.foreign';},x=>{x.namespaceSha256='sha256:'+'0'.repeat(64);},x=>{x.entries.push(x.entries[0]);},
    x=>{x.entries[0].directory='../outside';},x=>{x.entries[0].physical.ino='01';},x=>{x.extra=true;}]) {
    const document=JSON.parse(valid);change(document);const bytes=Buffer.from(json(document));await fs.writeFile(target,bytes);
    await assert.rejects(f.catalog.read(),{errorCode:'backend_project_catalog_corrupt'});await assert.rejects(f.catalog.remove(entry.buildId));
    assert.deepEqual(await fs.readFile(target),bytes);
  }
});

test('symlink and hardlink indices locks and manifests never grant recovery or overwrite outside files', async t => {
  const f=await fixture(t), entry=await f.catalog.capture(f.capture);await f.catalog.upsert(entry);
  const target=path.join(f.namespace,BACKEND_PROJECT_CATALOG_FILE), outside=path.join(f.temporary,'outside.json'), before=await fs.readFile(target);
  await fs.writeFile(outside,before);await fs.unlink(target);await fs.symlink(outside,target);
  await assert.rejects(f.catalog.read());await assert.rejects(f.catalog.remove(entry.buildId));assert.deepEqual(await fs.readFile(outside),before);
  await fs.unlink(target);await fs.link(outside,target);await assert.rejects(f.catalog.read(),changed);await assert.rejects(f.catalog.upsert(entry),changed);
  await fs.unlink(target);await fs.writeFile(target,before);
  const lock=path.join(f.namespace,'.backend-project-catalog.lock');await fs.symlink(outside,lock);await assert.rejects(f.catalog.upsert(entry),changed);await fs.unlink(lock);
  const manifest=path.join(f.directory,'backend-project.json'), manifestOutside=path.join(f.temporary,'manifest.json');await fs.rename(manifest,manifestOutside);await fs.link(manifestOutside,manifest);
  await assert.rejects(assertCatalogProject(entry),changed);assert.deepEqual(await fs.readFile(outside),before);
});

test('unknown stale lock is never removed or overwritten after the bounded wait expires', async t => {
  const f=await fixture(t), entry=await f.catalog.capture(f.capture), lock=path.join(f.namespace,'.backend-project-catalog.lock'), bytes=Buffer.from('old owner');
  await fs.writeFile(lock,bytes);const started=Date.now();await assert.rejects(f.catalog.upsert(entry),{errorCode:'backend_project_catalog_busy'});
  assert.ok(Date.now()-started>=1900&&Date.now()-started<4000);assert.deepEqual(await fs.readFile(lock),bytes);
  await assert.rejects(fs.stat(path.join(f.namespace,BACKEND_PROJECT_CATALOG_FILE)),{code:'ENOENT'});
});

test('namespace and project inode replacement cannot revive old receipts even at the same pathname', async t => {
  const f=await fixture(t), entry=await f.catalog.capture(f.capture);await f.catalog.upsert(entry);
  const moved=f.directory+'-old';await fs.rename(f.directory,moved);await fs.cp(moved,f.directory,{recursive:true});
  await assert.rejects(assertCatalogProject(entry),{errorCode:'backend_project_owner_changed'});
  await fs.rm(f.directory,{recursive:true});await fs.rename(moved,f.directory);
  const displaced=f.namespace+'-old';await fs.rename(f.namespace,displaced);await fs.cp(displaced,f.namespace,{recursive:true});
  await assert.rejects(f.catalog.read(),changed);await assert.rejects(f.catalog.remove(entry.buildId),changed);await assert.rejects(assertCatalogProject(entry),changed);
});

test('ancestor aliases and source-bearing symlinks are rejected without reading or creating outside namespaces', async t => {
  const f=await fixture(t), alias=path.join(f.temporary,'alias');await fs.symlink(path.join(f.temporary,'cache'),alias);
  const namespace=path.join(alias,'editor','a'.repeat(24),f.backendId), catalog=createBackendProjectCatalog({namespace,backendId:f.backendId});
  await assert.rejects(catalog.read(),changed);await assert.rejects(catalog.remove(randomUUID()),changed);
  const entry=await f.catalog.capture(f.capture), moved=f.directory+'-old';await fs.rename(f.directory,moved);await fs.symlink(moved,f.directory);
  await assert.rejects(assertCatalogProject(entry),changed);
});

test('known quarantine rename can update its recorded path while keeping the exact stable physical and source identity', async t => {
  const f=await fixture(t), entry=await f.catalog.capture(f.capture);await f.catalog.upsert(entry);
  const quarantine=path.join(f.namespace,`.viento-prune-${randomUUID()}`);await fs.rename(f.directory,quarantine);f.pin.directory=quarantine;
  const replacement=await f.catalog.capture({...f.capture,buildDirectory:quarantine});await f.catalog.upsert(replacement);
  const saved=(await f.catalog.read()).entries[0];assert.equal(saved.directory,path.basename(quarantine));assert.deepEqual(saved.physical,entry.physical);
  assert.equal((await assertCatalogProject(saved)).buildDirectory,quarantine);assert.equal(saved.buildId,entry.buildId);
});

test('record and byte budgets preserve existing entries rather than evicting foreign or earlier recovery data', async t => {
  const f=await fixture(t), entry=await f.catalog.capture(f.capture);await f.catalog.upsert(entry);
  const target=path.join(f.namespace,BACKEND_PROJECT_CATALOG_FILE), document=JSON.parse(await fs.readFile(target));
  document.entries=Array.from({length:256},(_,i)=>({...structuredClone(entry),buildId:randomUUID(),directory:randomUUID(),title:`Old ${i}`}));
  const before=Buffer.from(json(document));await fs.writeFile(target,before);
  await assert.rejects(f.catalog.upsert(entry),{errorCode:'backend_project_catalog_limit'});assert.deepEqual(await fs.readFile(target),before);
  document.entries=document.entries.slice(0,250).map(x=>({...x,sourcePath:'documents/'+'x'.repeat(3950)}));
  const large=Buffer.from(json(document));assert.ok(large.length>1024*1024);await fs.writeFile(target,large);
  await assert.rejects(f.catalog.remove(entry.buildId));assert.deepEqual(await fs.readFile(target),large);
});

test('failed publication and failed owned lock writes retain the previous index and allow a later normal update', async t => {
  const f=await fixture(t), a=await f.catalog.capture(f.capture), b=await f.catalog.capture(await seed(f,1));await f.catalog.upsert(a);
  const target=path.join(f.namespace,BACKEND_PROJECT_CATALOG_FILE), before=await fs.readFile(target), rename=fs.rename;
  fs.rename=async(from,to)=>{if(path.basename(from).startsWith('.backend-project-catalog-')&&to===target)throw Object.assign(new Error('fixture write failure'),{code:'EIO'});return rename(from,to);};
  try {await assert.rejects(f.catalog.upsert(b),changed);} finally {fs.rename=rename;}
  assert.deepEqual(await fs.readFile(target),before);await assert.rejects(fs.stat(path.join(f.namespace,'.backend-project-catalog.lock')),{code:'ENOENT'});
  const open=fs.open;
  fs.open=async(file,...args)=>{const handle=await open(file,...args);if(path.basename(file)==='.backend-project-catalog.lock')handle.writeFile=async()=>{throw Object.assign(new Error('fixture lock write failure'),{code:'EIO'});};return handle;};
  try {await assert.rejects(f.catalog.upsert(b),changed);} finally {fs.open=open;}
  assert.deepEqual(await fs.readFile(target),before);await assert.rejects(fs.stat(path.join(f.namespace,'.backend-project-catalog.lock')),{code:'ENOENT'});
  await f.catalog.upsert(b);assert.equal((await f.catalog.read()).entries.length,2);
});

test('a staged file removed after close retains the previous index releases its owned lock and permits retry', async t => {
  const f=await fixture(t), a=await f.catalog.capture(f.capture), b=await f.catalog.capture(await seed(f,1));await f.catalog.upsert(a);
  const target=path.join(f.namespace,BACKEND_PROJECT_CATALOG_FILE), before=await fs.readFile(target), open=fs.open;
  let removed=false;
  fs.open=async(file,...args)=>{
    const handle=await open(file,...args);
    if(path.basename(file).startsWith('.backend-project-catalog-')&&path.basename(file).endsWith('.tmp')) {
      const close=handle.close.bind(handle);handle.close=async()=>{await close();await fs.unlink(file);removed=true;};
    }
    return handle;
  };
  try {await assert.rejects(f.catalog.upsert(b),{errorCode:'backend_project_catalog_unavailable'});} finally {fs.open=open;}
  assert.equal(removed,true);assert.deepEqual(await fs.readFile(target),before);
  await assert.rejects(fs.stat(path.join(f.namespace,'.backend-project-catalog.lock')),{code:'ENOENT'});
  await f.catalog.upsert(b);assert.equal((await f.catalog.read()).entries.length,2);
});
