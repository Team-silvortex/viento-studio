import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';
import { readRegistry, withRegistryLock } from '../lib/workspace.mjs';
import { readTransactionStatus, transactionHash } from '../lib/world-transaction-state.mjs';
import { createExportService } from '../lib/export-service.mjs';
import { worldMutationDescriptors } from '../../engine/world-command-contract.mjs';
import { runWorldQuery } from '../world.mjs';
import { runCommand } from '../lib/process.mjs';
import { fixture, write, serve, request } from './helpers.mjs';
import { nativeMobileLibrary } from './mobile-native-harness.mjs';
import { createMobilePlatform } from '../../mobile/platform.mjs';

const ids = { hero: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', story: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', asset: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
const recordPath = id => `metadata/documents/${id}.json`, journal = '.viento/world-transactions';
async function command(root, objectId = ids.story, slot = 'illustration', resourceId = ids.asset) {
  const view = await readWorldProjection(root);
  return { command: 'resource.bind', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    objectId, objectRevision: view.objects.find(item => item.id === objectId).revision,
    resourceId, resourceRevision: view.resources.find(item => item.id === resourceId)?.revision || `sha256:${'0'.repeat(64)}`, slot,
    actorRef: { kind: 'tool', id: 'resource-test' } };
}
async function materialize(t, version = 3, root) {
  if (!root) { root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-resources-')); t.after(() => fs.rm(root, { recursive: true, force: true })); }
  const frozen = JSON.parse(await fs.readFile(new URL(`fixtures/predecessor/v${version}.json`, import.meta.url)));
  for (const [file, content] of Object.entries(frozen.files)) await write(root, file, content);
  const before = frozen.files[recordPath(ids.story)].replace('"assetBindings": []',
    '"extension":{"large":9007199254740993,"negativeZero":-0,"scientific":1.2300e+4},"assetBindings": []').replace(/\n/g, '\r\n');
  await write(root, recordPath(ids.story), before);
  return { root, input: await command(root), before, file: recordPath(ids.story), execute: createWorldCommandService(root) };
}
async function fingerprint(root) {
  const files = {};
  async function walk(dir, prefix = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = `${prefix}${entry.name}`, absolute = path.join(dir, entry.name);
      if (file === '.viento/registry.lock') continue; // A dead worker's lock is reclaimed during recovery.
      if (entry.isDirectory()) await walk(absolute, `${file}/`); else files[file] = transactionHash(await fs.readFile(absolute));
    }
  }
  await walk(root); return files;
}
async function crash(f, point, index = '-', recovery = false) {
  const requestFile = path.join(f.root, '.request.json'); await fs.writeFile(requestFile, JSON.stringify(f.input));
  const child = fork(new URL('./world-transaction-crash-worker.mjs', import.meta.url), [f.root, recovery ? 'recover' : requestFile, point, String(index)], { silent: true, execArgv: [] });
  let timeout, stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'exit');
  try {
    const event = await Promise.race([once(child, 'message').then(([value]) => value),
      exited.then(() => { throw new Error(`Worker exited: ${stderr}`); }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Worker timeout: ${stderr}`)), 15000); })]);
    assert.equal(event.stage, point);
  } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited; await fs.rm(requestFile, { force: true }); }
}

for (const version of [2, 3]) test(`resource.bind v${version}: zero-write preview, exact insertion and revision agreement`, async t => {
  const f = await materialize(t, version), before = await fingerprint(f.root), view = await readWorldProjection(f.root);
  const file = path.join(f.root, f.file); await fs.chmod(file, 0o640);
  const preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.deepEqual(await fingerprint(f.root), before);
  const descriptor = worldMutationDescriptors().find(item => item.id === 'resource.bind'), ajv = new Ajv();
  for (const [schema, value] of [['command-descriptor', descriptor], ['changeset', preview.proposal]]) {
    const validate = ajv.compile(JSON.parse(await fs.readFile(new URL(`../../schemas/${schema}-v1.schema.json`, import.meta.url))));
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
  }
  const { command, ...args } = f.input;
  assert.equal(ajv.compile(descriptor.inputSchema)(args), true); assert.equal(ajv.compile(descriptor.outputSchema)(preview), true);
  const result = await f.execute(f.input), actual = await fs.readFile(file, 'utf8');
  assert.deepEqual({ ...result, receipt: undefined }, { ...preview, status: 'applied', receipt: undefined });
  assert.equal(actual.replace(JSON.stringify({ assetId: ids.asset, role: 'illustration' }), ''), f.before);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o640);
  const after = await fingerprint(f.root); delete after[`${journal}/head.json`];
  delete before[f.file]; delete after[f.file]; assert.deepEqual(after, before, 'no source or asset content changes');
  const next = await readWorldProjection(f.root);
  assert.equal(next.world.revision, preview.revision); assert.equal(result.receipt.revision, preview.revision);
  assert.deepEqual(next.resourceBindings.find(item => item.id === preview.binding.id), preview.binding);
  assert.deepEqual(next.resources, view.resources); assert.deepEqual(next.relations, view.relations);
  for (const object of view.objects) {
    const updated = next.objects.find(item => item.id === object.id);
    assert.deepEqual(updated.properties, object.properties); assert.deepEqual(updated.documentRefs, object.documentRefs);
    if (object.id !== ids.story) assert.equal(updated.revision, object.revision);
  }
  await assert.rejects(f.execute(f.input), error => error.errorCode === 'world_revision_conflict');
  await assert.rejects(f.execute(await makeFresh(f)), error => error.errorCode === 'world_resource_binding_exists');
});
const makeFresh = f => command(f.root);

test('all registered resource kinds, custom roles, shared roles and multiple roles retain their identities', async t => {
  const f = await materialize(t);
  for (const [index, kind] of ['image','video','audio','font','text','other'].entries()) {
    const assetId = `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12,'0')}`;
    const record = JSON.parse(await fs.readFile(path.join(f.root, `metadata/assets/${ids.asset}.json`)));
    record.id = assetId; record.kind = kind; record.location.path = `${kind}.bin`; record.legacyPaths = [];
    record.content = null;
    await write(f.root, `metadata/assets/${assetId}.json`, JSON.stringify(record));
    await f.execute(await command(f.root, ids.story, '自由用途 🎵', assetId));
  }
  await f.execute(await command(f.root, ids.hero, 'portrait'));
  await f.execute(await command(f.root, ids.hero, 'voice'));
  const view = await readWorldProjection(f.root);
  assert.equal(view.resourceBindings.filter(item => item.objectId === ids.hero).length, 3);
  assert.equal(view.resourceBindings.filter(item => item.slot === '自由用途 🎵').length, 6);
  assert.equal(view.resources.every(item => item.contentVerified === false), true);
});

test('offline, changed-size and unverified resources remain bindable without pretending to verify their bytes', async t => {
  for (const state of ['missing', 'size-changed', 'present-unverified']) {
    const f = await materialize(t), file = path.join(f.root, 'assets/reference.svg');
    if (state === 'missing') await fs.rm(file);
    else if (state === 'size-changed') await fs.writeFile(file, 'modified');
    else await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('blue','pink'));
    const before = await fingerprint(f.root);
    const result = await f.execute(f.input), view = await readWorldProjection(f.root);
    assert.equal(view.world.revision, result.revision);
    assert.equal(view.resources[0].availability, state); assert.equal(view.resources[0].contentVerified, false);
    assert.equal((await fingerprint(f.root))['assets/reference.svg'], before['assets/reference.svg']);
  }
});

test('binding contract rejects missing versions, invalid slots, missing identities and source-less objects without writes', async t => {
  const f = await materialize(t), before = await fingerprint(f.root);
  for (const patch of [{ force: true }, { slot: '' }, { slot: ' \n ' }, { slot: '\uD800' }, { slot: 'x'.repeat(201) }, { slot: 5 }]) {
    await assert.rejects(f.execute({ ...f.input, ...patch }), error => error.errorCode === 'world_command_invalid');
  }
  for (const key of ['baseRevision','objectRevision','resourceRevision','actorRef']) {
    const input = { ...f.input }; delete input[key];
    await assert.rejects(f.execute(input), error => error.errorCode === 'world_command_invalid');
  }
  for (const key of ['resourceId','objectId']) await assert.rejects(f.execute({ ...f.input,
    [key]: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }), error => error.errorCode === 'world_resource_target_missing');
  for (const key of ['objectRevision','resourceRevision']) await assert.rejects(f.execute({ ...f.input,
    [key]: `sha256:${'0'.repeat(64)}` }), error => error.errorCode === 'world_revision_conflict');
  assert.deepEqual(await fingerprint(f.root), before);
  await fs.rm(path.join(f.root, JSON.parse(f.before).sourcePath));
  await assert.rejects(f.execute(await makeFresh(f)), error => error.errorCode === 'world_resource_read_only');
});

test('existing binding bytes and unknown fields survive appends; duplicate keys and oversized registrations are refused', async t => {
  const f = await materialize(t), file = path.join(f.root, recordPath(ids.hero));
  const original = (await fs.readFile(file,'utf8')).replace('"role": "attachment"', '"role": "attachment", "extension":9007199254740993');
  await fs.writeFile(file, original);
  const preview = await f.execute({ ...await command(f.root, ids.hero, 'portrait'), mode: 'preview' });
  await f.execute(await command(f.root, ids.hero, 'portrait'));
  assert.equal((await fs.readFile(file, 'utf8')).replace(', '+JSON.stringify(preview.binding.descriptor), ''), original);
  const other = await materialize(t), otherFile = path.join(other.root, other.file);
  for (const content of [other.before.replace('"assetBindings": []', '"assetBindings": [], "assetBindings": []'),
    other.before.replace('"extension":', '"padding":"'+'x'.repeat(1024*1024)+'", "extension":')]) {
    await fs.writeFile(otherFile, content); const before = await fingerprint(other.root);
    await assert.rejects(other.execute(await makeFresh(other)), error => ['world_record_invalid','world_record_limit'].includes(error.errorCode));
    assert.deepEqual(await fingerprint(other.root), before);
  }
});

test('resource registration edits invalidate previews while formatting-only document edits are retained', async t => {
  const f = await materialize(t), file = path.join(f.root, f.file), preview = await f.execute({ ...f.input, mode: 'preview' });
  const formatted = f.before.replaceAll('  ', '\t'); await fs.writeFile(file, formatted);
  assert.equal((await f.execute(f.input)).revision, preview.revision);
  assert.equal((await fs.readFile(file, 'utf8')).replace(JSON.stringify(preview.binding.descriptor), ''), formatted);
  const other = await materialize(t), asset = path.join(other.root, `metadata/assets/${ids.asset}.json`), stat = await fs.stat(asset);
  await fs.writeFile(asset, (await fs.readFile(asset, 'utf8')).replace('reference.svg','different.svg'));
  await fs.utimes(asset, stat.atime, stat.mtime);
  const before = await fingerprint(other.root);
  await assert.rejects(other.execute(other.input), error => error.errorCode === 'world_revision_conflict');
  assert.deepEqual(await fingerprint(other.root), before);
});

for (const [point,index,committed] of [['intent','-',false],['source-ready',0,false],['data',0,false],['commit','-',true],['head','-',true]]) {
  test(`resource.bind SIGKILL ${point}/${index}: recover the ${committed ? 'new' : 'old'} binding`, async t => {
    const f = await materialize(t), preview = await f.execute({ ...f.input, mode:'preview' });
    await crash(f,point,index);
    for (const read of [()=>readWorldProjection(f.root), ()=>readRegistry(f.root), ()=>createExportService(f.root).create({}), ()=>withRegistryLock(f.root,()=>assert.fail('legacy writer entered'))]) {
      await assert.rejects(read(), error=>error.errorCode==='world_recovery_required');
    }
    const result = await runWorldQuery(['--root',f.root,'--recover']); assert.equal(result.status,committed?'committed':'rolled-back');
    assert.equal((await readWorldProjection(f.root)).world.revision,committed?preview.revision:f.input.baseRevision);
    if (!committed) assert.equal(await fs.readFile(path.join(f.root,f.file),'utf8'),f.before);
    assert.equal((await recoverWorldTransaction(f.root)).status,'idle');
    assert.equal(Object.keys(await fingerprint(f.root)).some(file=>/\/\.viento-[^/]+\.tmp$/.test(file)),false);
  });
}

test('resource recovery can be interrupted and resumed in either direction', async t => {
  for (const committed of [false,true]) {
    const f = await materialize(t), preview = await f.execute({ ...f.input, mode:'preview' });
    await crash(f,committed?'commit':'data',committed?'-':0);
    if (committed) await fs.writeFile(path.join(f.root,f.file),f.before);
    await crash(f,'recovery-file',0,true); await recoverWorldTransaction(f.root);
    assert.equal((await readWorldProjection(f.root)).world.revision,committed?preview.revision:f.input.baseRevision);
  }
});

for (const kind of ['foreign-record','foreign-resource','missing-resource','foreign-temporary','bad-after-image','arbitrary-metadata-edit','escaping-path','symlink-target','invalid-binding','duplicate-binding']) {
  test(`resource recovery preserves all files on ${kind}`, async t => {
    const f = await materialize(t); await crash(f,'data',0);
    const intentFile = path.join(f.root,journal,'active/intent.json'), intent = JSON.parse(await fs.readFile(intentFile));
    const file = path.join(f.root,f.file), afterFile = path.join(f.root,journal,'active/0.after');
    const asset = path.join(f.root,`metadata/assets/${ids.asset}.json`);
    if (kind==='foreign-record') await fs.writeFile(file,(await fs.readFile(file,'utf8')).replace('illustration','external'));
    if (kind==='foreign-resource') await fs.writeFile(asset,(await fs.readFile(asset,'utf8')).replace('"tags": []','"tags": ["external"]'));
    if (kind==='missing-resource') await fs.rm(asset);
    if (kind==='foreign-temporary') await write(f.root,'metadata/documents/unrelated.tmp','keep this file');
    if (kind==='bad-after-image') await fs.writeFile(afterFile,'truncated');
    if (kind==='arbitrary-metadata-edit') {
      const changed=(await fs.readFile(afterFile,'utf8')).replace('"parserProfile": "prose"','"parserProfile": "structured"');
      await fs.writeFile(afterFile,changed); intent.entries[0].after=transactionHash(changed); await fs.writeFile(intentFile,JSON.stringify(intent));
    }
    if (kind==='escaping-path') { intent.entries[0].sourcePath='workspace.json'; await fs.writeFile(intentFile,JSON.stringify(intent)); }
    if (kind==='symlink-target') { await fs.rm(file); await fs.symlink(afterFile,file); }
    if (kind==='invalid-binding') { intent.mutation.role=''; await fs.writeFile(intentFile,JSON.stringify(intent)); }
    if (kind==='duplicate-binding') {
      const before = await fs.readFile(afterFile), changed = before.toString().replace('"assetBindings": [','"assetBindings": ['+JSON.stringify(intent.mutation)+',');
      await fs.writeFile(path.join(f.root,journal,'active/0.before'), before); intent.entries[0].before=transactionHash(before);
      await fs.writeFile(afterFile,changed); intent.entries[0].after=transactionHash(changed); await fs.writeFile(intentFile,JSON.stringify(intent));
    }
    const before=await fingerprint(f.root);
    await assert.rejects(recoverWorldTransaction(f.root),error=>['world_recovery_conflict','world_journal_invalid'].includes(error.errorCode));
    assert.deepEqual(await fingerprint(f.root),before); assert.equal((await readTransactionStatus(f.root)).pending,true);
  });
}

test('publication errors roll back, and committed writes succeed despite lost completion', async t => {
  const f=await materialize(t);
  const failing=createWorldCommandService(f.root,{checkpoint:async stage=>{if(stage==='data')throw new Error('disk failure');}});
  await assert.rejects(failing(f.input)); assert.equal(await fs.readFile(path.join(f.root,f.file),'utf8'),f.before);
  const committed=createWorldCommandService(f.root,{checkpoint:async stage=>{if(stage==='commit')throw new Error('lost response');}});
  assert.equal((await committed(f.input)).status,'applied');
});

test('concurrent bindings serialize against the same world and retain existing attachments', async t => {
  const f = await materialize(t), other = await command(f.root, ids.hero, 'portrait');
  const results = await Promise.allSettled([f.execute(f.input), createWorldCommandService(f.root)(other)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.errorCode, 'world_revision_conflict');
  assert.equal((await readWorldProjection(f.root)).resourceBindings.length, 2);
  await f.execute(await command(f.root, results[0].status === 'fulfilled' ? ids.hero : ids.story,
    results[0].status === 'fulfilled' ? 'portrait' : 'illustration'));
  assert.equal((await readWorldProjection(f.root)).resourceBindings.length, 3);
  assert.equal((await readTransactionStatus(f.root)).pending, false);
});

test('HTTP and CLI agree; auth, index resource refresh and startup recovery include resource bindings', async t => {
  const root=await fixture(t), f=await materialize(t,3,root), copy=await materialize(t);
  const base=await serve(t,root,{DOC_API_REQUIRE_WRITE_AUTH:'1',DOC_API_TOKEN:'resource-fixture-token'});
  assert.equal((await request(base,'/api/capabilities')).data.semanticCommands.includes('resource.bind'),true);
  assert.equal((await request(base,'/api/world/commands',f.input)).status,401);
  const post=async(url,payload)=>{
    const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer resource-fixture-token'},body:JSON.stringify(payload)});
    assert.equal(response.status,200); return (await response.json()).data;
  };
  const inputFile=path.join(copy.root,'.request.json'); await fs.writeFile(inputFile,JSON.stringify({...f.input,mode:'preview'}));
  const preview=await post('/api/world/commands',{...f.input,mode:'preview'});
  assert.deepEqual(preview,await runWorldQuery(['--root',copy.root,'--request',inputFile]));
  const applied=await post('/api/world/commands',f.input); assert.equal(applied.revision,preview.revision);
  await fs.writeFile(inputFile,JSON.stringify(f.input)); const cli=await runWorldQuery(['--root',copy.root,'--request',inputFile]); assert.equal(cli.revision,applied.revision);
  assert.deepEqual(await fs.readFile(path.join(root,f.file)),await fs.readFile(path.join(copy.root,copy.file)));
  await post('/api/rebuild',{});
  const index=(await request(base,'/api/index')).data;
  assert.equal(index.docs.find(item=>item.id===ids.story).assetRefs.includes(ids.asset),true);
  const other=await fixture(t), pending=await materialize(t,3,other); await crash(pending,'data',0);
  const restarted=await serve(t,other); assert.equal((await request(restarted,'/api/world/transaction')).data.pending,false);
  assert.equal(await fs.readFile(path.join(other,pending.file),'utf8'),pending.before);
});

for(const version of [2,3]) test(`v${version} resource binding survives desktop → mobile → desktop archives`,{
  skip:!process.env.VIENTO_TEST_ARCHIVE_BINARY||!process.env.VIENTO_MOBILE_STORE_BIN,
},async t=>{
  const f=await materialize(t,version), binary=process.env.VIENTO_TEST_ARCHIVE_BINARY, incoming=path.join(f.root,'incoming.zip');
  await crash(f,'data',0); await assert.rejects(runCommand(binary,['export',f.root,incoming])); await recoverWorldTransaction(f.root);
  const result=await f.execute(f.input); await runCommand(binary,['export',f.root,incoming]);
  const library=await nativeMobileLibrary(process.env.VIENTO_MOBILE_STORE_BIN,path.join(f.root,'mobile')); t.after(()=>library.close());
  const work=await library.invoke('mobile_storage',{action:'importArchive',path:incoming});
  const context=await library.invoke('mobile_storage',{action:'context',workspaceId:work.id});
  assert.deepEqual(context.documents.find(item=>item.id===ids.story).assetBindings,[{assetId:ids.asset,role:'illustration'}]);
  const index=await createMobilePlatform({invoke:library.invoke,workspaceId:work.id}).index();
  assert.equal(index.docs.some(item=>item.id===ids.story),true, 'imported documents remain readable; mobile media UI is not enabled');
  const outgoing=path.join(f.root,'outgoing.zip'); await library.invoke('mobile_storage',{action:'exportArchive',workspaceId:work.id,path:outgoing});
  const parent=path.join(f.root,'restored'); await fs.mkdir(parent);
  const restored=JSON.parse((await runCommand(binary,['import',outgoing,parent])).stdout).root;
  assert.equal((await readWorldProjection(restored)).world.revision,result.revision);
  const frozen=JSON.parse(await fs.readFile(new URL(`fixtures/predecessor/v${version}.json`,import.meta.url)));
  for(const file of Object.keys(frozen.files)) assert.deepEqual(await fs.readFile(path.join(restored,file)),await fs.readFile(path.join(f.root,file)),file);
});

test('resource planning runs with browser globals and no host dependencies',async()=>{
  const result=await runCommand(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('world-portable-runtime.mjs',import.meta.url)),'--resources']);
  assert.deepEqual(JSON.parse(result.stdout),{slot:'portrait',largeNumberPreserved:true,unchanged:true});
});
