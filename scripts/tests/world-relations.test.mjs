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

const ids = { hero: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', story: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', companion: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
const recordPath = id => `metadata/documents/${id}.json`, journal = '.viento/world-transactions';
async function command(root, objectId = ids.story, targetObjectId = ids.companion, kind = 'part-of', slot = '共同背景') {
  const view = await readWorldProjection(root);
  return { command: 'relation.add', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    objectId, objectRevision: view.objects.find(item => item.id === objectId).revision,
    targetObjectId, targetRevision: view.objects.find(item => item.id === targetObjectId).revision, kind, slot,
    actorRef: { kind: 'tool', id: 'relation-test' } };
}
async function materialize(t, version = 3, root) {
  if (!root) { root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-relations-')); t.after(() => fs.rm(root, { recursive: true, force: true })); }
  const frozen = JSON.parse(await fs.readFile(new URL(`fixtures/predecessor/v${version}.json`, import.meta.url)));
  for (const [file, content] of Object.entries(frozen.files)) await write(root, file, content);
  const record = JSON.parse(frozen.files[recordPath(ids.hero)]);
  record.id = ids.companion; record.sourcePath = frozen.sourcePath.replace('traveler.md', 'companion.md');
  await write(root, recordPath(ids.companion), JSON.stringify(record));
  await write(root, record.sourcePath, '\uFEFF# 同伴\r\n姓名：同伴\r\n生命：200\r\n');
  const before = frozen.files[recordPath(ids.story)].replace('"slot": "背景"', '"slot": "背景", "unknown": {"count":9007199254740993}')
    .replace('"relations": [', '"extension": {"negativeZero":-0,"scientific":1.2300e+4},\n  "relations": [').replace(/\n/g, '\r\n');
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

for (const version of [2, 3]) test(`relation.add v${version}: pure preview, exact metadata insertion, source preservation and matching revision`, async t => {
  const f = await materialize(t, version), before = await fingerprint(f.root), view = await readWorldProjection(f.root);
  const file = path.join(f.root, f.file); await fs.chmod(file, 0o640);
  const preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.deepEqual(await fingerprint(f.root), before);
  const descriptor = worldMutationDescriptors().find(item => item.id === 'relation.add'), ajv = new Ajv();
  for (const [schema, value] of [['command-descriptor', descriptor], ['changeset', preview.proposal]]) {
    const validate = ajv.compile(JSON.parse(await fs.readFile(new URL(`../../schemas/${schema}-v1.schema.json`, import.meta.url))));
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
  }
  const { command, ...args } = f.input;
  assert.equal(ajv.compile(descriptor.inputSchema)(args), true); assert.equal(ajv.compile(descriptor.outputSchema)(preview), true);
  const result = await f.execute(f.input), actual = await fs.readFile(file, 'utf8');
  assert.deepEqual({ ...result, receipt: undefined }, { ...preview, status: 'applied', receipt: undefined });
  assert.equal(actual.replace(', '+JSON.stringify({ kind:'part-of', targetId:ids.companion, slot:'共同背景' }), ''), f.before);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o640);
  assert.match(actual, /9007199254740993/); assert.match(actual, /1\.2300e\+4/); assert.match(actual, /"negativeZero":-0/);
  const after = await fingerprint(f.root); delete after[`${journal}/head.json`];
  delete before[f.file]; delete after[f.file]; assert.deepEqual(after, before, 'only the source registration changes');
  const next = await readWorldProjection(f.root);
  assert.equal(next.world.revision, preview.revision); assert.equal(result.receipt.revision, preview.revision);
  assert.deepEqual(next.relations.find(item => item.id === preview.relation.id), preview.relation);
  for (const object of view.objects) {
    const updated = next.objects.find(item => item.id === object.id);
    assert.deepEqual(updated.properties, object.properties); assert.deepEqual(updated.documentRefs, object.documentRefs);
    if (object.id !== ids.story) assert.equal(updated.revision, object.revision);
  }
  await assert.rejects(f.execute(f.input), error => error.errorCode === 'world_revision_conflict');
  await assert.rejects(f.execute(await commandForDuplicate(f.root)), error => error.errorCode === 'world_relation_exists');
});
async function commandForDuplicate(root) { return command(root, ids.story, ids.companion, 'part-of', 'Different slot'); }

test('relation.add rejects self links, duplicate endpoints, direct and transitive ownership cycles, but permits reference cycles', async t => {
  const f = await materialize(t), before = await fingerprint(f.root);
  await assert.rejects(f.execute(await command(f.root, ids.hero, ids.hero)), error => error.errorCode === 'world_relation_self');
  await assert.rejects(f.execute(await command(f.root, ids.story, ids.hero)), error => error.errorCode === 'world_relation_exists');
  await assert.rejects(f.execute(await command(f.root, ids.hero, ids.story)), error => error.errorCode === 'world_relation_cycle');
  assert.deepEqual(await fingerprint(f.root), before);
  await f.execute(await command(f.root, ids.hero, ids.companion));
  await assert.rejects(f.execute(await command(f.root, ids.companion, ids.story)), error => error.errorCode === 'world_relation_cycle');
  await f.execute(await command(f.root, ids.hero, ids.companion, 'references'));
  await f.execute(await command(f.root, ids.companion, ids.hero, 'references'));
  assert.equal((await readRegistry(f.root)).documents.find(record => record.id === ids.hero).relations.length, 2);
});

test('relation contract rejects unsupported kinds, malformed labels, missing revisions and nonexistent or unavailable targets without writes', async t => {
  const f = await materialize(t), before = await fingerprint(f.root);
  for (const patch of [{ force: true }, { kind: 'arbitrary' }, { slot: '\uD800' }, { slot: 'a'.repeat(201) }, { slot: 5 }]) {
    await assert.rejects(f.execute({ ...f.input, ...patch }), error => error.errorCode === 'world_command_invalid');
  }
  for (const key of ['baseRevision','objectRevision','targetRevision','actorRef']) {
    const input = { ...f.input }; delete input[key];
    await assert.rejects(f.execute(input), error => error.errorCode === 'world_command_invalid');
  }
  await assert.rejects(f.execute({ ...f.input, targetObjectId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }), error => error.errorCode === 'world_relation_object_missing');
  await assert.rejects(f.execute({ ...f.input, targetRevision: `sha256:${'0'.repeat(64)}` }), error => error.errorCode === 'world_revision_conflict');
  assert.deepEqual(await fingerprint(f.root), before);
  const target = (await readRegistry(f.root)).documents.find(record => record.id === ids.companion);
  await fs.rm(path.join(f.root, target.sourcePath));
  await assert.rejects(f.execute(await command(f.root)), error => error.errorCode === 'world_relation_read_only');
});

test('metadata without a relations field gains only the new property; ambiguous duplicate keys are refused', async t => {
  const f = await materialize(t), heroPath = path.join(f.root, recordPath(ids.hero));
  const hero = JSON.parse(await fs.readFile(heroPath)); delete hero.relations; hero.documentType = 'unknown-extension';
  const original = JSON.stringify(hero).replace('"assetBindings"', '"integer":9007199254740993,"assetBindings"');
  await fs.writeFile(heroPath, original);
  await f.execute(await command(f.root, ids.hero, ids.companion, 'references', ''));
  const actual = await fs.readFile(heroPath, 'utf8');
  assert.equal(actual.replace(', "relations": [{"kind":"references","targetId":"'+ids.companion+'","slot":""}]', ''), original);
  const other = await materialize(t);
  await fs.writeFile(path.join(other.root, other.file), other.before.replace('"relations": [', '"relations": [], "relations": ['));
  const before = await fingerprint(other.root);
  await assert.rejects(other.execute(await command(other.root)), error => error.errorCode === 'world_record_invalid');
  assert.deepEqual(await fingerprint(other.root), before);
});

test('external semantic edits invalidate previews; formatting-only edits survive a subsequent guarded insertion', async t => {
  const f = await materialize(t), file = path.join(f.root, f.file), preview = await f.execute({ ...f.input, mode: 'preview' });
  const formatted = f.before.replaceAll('  ', '\t'); await fs.writeFile(file, formatted);
  assert.equal((await readWorldProjection(f.root)).world.revision, f.input.baseRevision);
  assert.equal((await f.execute(f.input)).revision, preview.revision);
  assert.equal((await fs.readFile(file,'utf8')).replace(', '+JSON.stringify(preview.relation.properties), ''), formatted);
  const other = await materialize(t), otherFile = path.join(other.root, other.file), stat = await fs.stat(otherFile);
  await fs.writeFile(otherFile, other.before.replace('背景','往事')); await fs.utimes(otherFile, stat.atime, stat.mtime);
  await assert.rejects(other.execute(other.input), error => error.errorCode === 'world_revision_conflict');
});

for (const [point,index,committed] of [['intent','-',false],['source-ready',0,false],['data',0,false],['commit','-',true],['head','-',true]]) {
  test(`relation.add SIGKILL ${point}/${index}: restore the ${committed ? 'new' : 'old'} graph`, async t => {
    const f = await materialize(t), preview = await f.execute({ ...f.input, mode:'preview' });
    await crash(f,point,index);
    for (const read of [()=>readWorldProjection(f.root), ()=>readRegistry(f.root), ()=>createExportService(f.root).create({}), ()=>withRegistryLock(f.root,()=>assert.fail('legacy writer entered'))]) {
      await assert.rejects(read(), error=>error.errorCode==='world_recovery_required');
    }
    const result = await runWorldQuery(['--root',f.root,'--recover']); assert.equal(result.status,committed?'committed':'rolled-back');
    const view = await readWorldProjection(f.root); assert.equal(view.world.revision,committed?preview.revision:f.input.baseRevision);
    if (!committed) assert.equal(await fs.readFile(path.join(f.root,f.file),'utf8'),f.before);
    assert.equal((await recoverWorldTransaction(f.root)).status,'idle');
    assert.equal(Object.keys(await fingerprint(f.root)).some(file=>/\/\.viento-[^/]+\.tmp$/.test(file)),false);
  });
}

test('relation recovery is repeatable after another crash during both rollback and roll-forward', async t => {
  for (const committed of [false,true]) {
    const f = await materialize(t), preview = await f.execute({ ...f.input, mode:'preview' });
    await crash(f,committed?'commit':'data',committed?'-':0);
    if (committed) await fs.writeFile(path.join(f.root,f.file),f.before);
    await crash(f,'recovery-file',0,true); await recoverWorldTransaction(f.root);
    assert.equal((await readWorldProjection(f.root)).world.revision,committed?preview.revision:f.input.baseRevision);
  }
});

for (const kind of ['foreign-record','foreign-target','missing-target','foreign-temporary','bad-after-image','arbitrary-metadata-edit','escaping-path','symlink-target']) {
  test(`relation recovery preserves every file on ${kind}`, async t => {
    const f = await materialize(t); await crash(f,'data',0);
    const intentFile = path.join(f.root,journal,'active/intent.json'), intent = JSON.parse(await fs.readFile(intentFile));
    const file = path.join(f.root,f.file), afterFile = path.join(f.root,journal,'active/0.after');
    if (kind==='foreign-record') await fs.writeFile(file,(await fs.readFile(file,'utf8')).replace('共同背景','外部修改'));
    if (kind==='foreign-target') {
      const targetFile = path.join(f.root,recordPath(ids.companion)), target=JSON.parse(await fs.readFile(targetFile)); target.external=true; await fs.writeFile(targetFile,JSON.stringify(target));
    }
    if (kind==='missing-target') await fs.rm(path.join(f.root,recordPath(ids.companion)));
    if (kind==='foreign-temporary') await write(f.root,'metadata/documents/unrelated.tmp','preserve this foreign file');
    if (kind==='bad-after-image') await fs.writeFile(afterFile,'truncated');
    if (kind==='arbitrary-metadata-edit') {
      const changed=(await fs.readFile(afterFile,'utf8')).replace('"parserProfile": "prose"','"parserProfile": "structured"');
      await fs.writeFile(afterFile,changed); intent.entries[0].after=transactionHash(changed); await fs.writeFile(intentFile,JSON.stringify(intent));
    }
    if (kind==='escaping-path') { intent.entries[0].sourcePath='workspace.json'; await fs.writeFile(intentFile,JSON.stringify(intent)); }
    if (kind==='symlink-target') { await fs.rm(file); await fs.symlink(afterFile,file); }
    const before=await fingerprint(f.root);
    await assert.rejects(recoverWorldTransaction(f.root),error=>['world_recovery_conflict','world_journal_invalid'].includes(error.errorCode));
    assert.deepEqual(await fingerprint(f.root),before); assert.equal((await readTransactionStatus(f.root)).pending,true);
  });
}

test('ordinary relation publication failures roll back; a lost completion after commit remains successful', async t => {
  const f=await materialize(t);
  const failing=createWorldCommandService(f.root,{checkpoint:async stage=>{if(stage==='data')throw new Error('disk failure');}});
  await assert.rejects(failing(f.input)); assert.equal(await fs.readFile(path.join(f.root,f.file),'utf8'),f.before);
  const committed=createWorldCommandService(f.root,{checkpoint:async stage=>{if(stage==='commit')throw new Error('lost response');}});
  assert.equal((await committed(f.input)).status,'applied');
});

test('concurrent relation commands serialize against the same World baseline without losing either existing graph or source data', async t => {
  const f = await materialize(t), other = await command(f.root, ids.hero, ids.companion, 'references');
  const results = await Promise.allSettled([f.execute(f.input), createWorldCommandService(f.root)(other)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.errorCode, 'world_revision_conflict');
  assert.equal((await readWorldProjection(f.root)).relations.length, 2);
  assert.equal((await readTransactionStatus(f.root)).pending, false);
  const fresh = await command(f.root, results[0].status === 'fulfilled' ? ids.hero : ids.story, ids.companion,
    results[0].status === 'fulfilled' ? 'references' : 'part-of');
  await f.execute(fresh); assert.equal((await readWorldProjection(f.root)).relations.length, 3);
});

test('HTTP and CLI agree; auth, index hierarchy rebuild and server startup recovery include relation edits', async t => {
  const root=await fixture(t), f=await materialize(t,3,root), copy=await materialize(t);
  const base=await serve(t,root,{DOC_API_REQUIRE_WRITE_AUTH:'1',DOC_API_TOKEN:'relation-fixture-token'});
  assert.equal((await request(base,'/api/capabilities')).data.semanticCommands.includes('relation.add'),true);
  assert.equal((await request(base,'/api/world/commands',f.input)).status,401);
  const post=async(url,payload)=>{
    const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer relation-fixture-token'},body:JSON.stringify(payload)});
    assert.equal(response.status,200); return (await response.json()).data;
  };
  const inputFile=path.join(copy.root,'.request.json'); await fs.writeFile(inputFile,JSON.stringify({...f.input,mode:'preview'}));
  const preview=await post('/api/world/commands',{...f.input,mode:'preview'});
  assert.deepEqual(preview,await runWorldQuery(['--root',copy.root,'--request',inputFile]));
  const applied=await post('/api/world/commands',f.input); assert.equal(applied.revision,preview.revision);
  await fs.writeFile(inputFile,JSON.stringify(f.input)); const cli=await runWorldQuery(['--root',copy.root,'--request',inputFile]); assert.equal(cli.revision,applied.revision);
  assert.deepEqual(await fs.readFile(path.join(root,f.file)),await fs.readFile(path.join(copy.root,copy.file)));
  await post('/api/rebuild',{});
  assert.equal((await request(base,'/api/index')).data.docs.some(item=>item.id===ids.story),true);
  const index=JSON.parse(await fs.readFile(path.join(root,'.viento/cache/indexes/documents.json')));
  assert.equal(index.docs.find(item=>item.id===ids.story).owners.length,2);
  assert.equal(index.docs.find(item=>item.id===ids.companion).ownedDocuments[0].id,ids.story);
  const other=await fixture(t), pending=await materialize(t,3,other); await crash(pending,'data',0);
  const restarted=await serve(t,other); assert.equal((await request(restarted,'/api/world/transaction')).data.pending,false);
  assert.equal(await fs.readFile(path.join(other,pending.file),'utf8'),pending.before);
});

for(const version of [2,3]) test(`v${version} shared ownership survives desktop → mobile → desktop archives`,{
  skip:!process.env.VIENTO_TEST_ARCHIVE_BINARY||!process.env.VIENTO_MOBILE_STORE_BIN,
},async t=>{
  const f=await materialize(t,version), binary=process.env.VIENTO_TEST_ARCHIVE_BINARY, incoming=path.join(f.root,'incoming.zip');
  await crash(f,'data',0); await assert.rejects(runCommand(binary,['export',f.root,incoming])); await recoverWorldTransaction(f.root);
  const result=await f.execute(f.input); await runCommand(binary,['export',f.root,incoming]);
  const library=await nativeMobileLibrary(process.env.VIENTO_MOBILE_STORE_BIN,path.join(f.root,'mobile')); t.after(()=>library.close());
  const work=await library.invoke('mobile_storage',{action:'importArchive',path:incoming});
  const index=await createMobilePlatform({invoke:library.invoke,workspaceId:work.id}).index();
  assert.equal(index.docs.find(item=>item.id===ids.story).owners.length,2);
  assert.equal(index.docs.find(item=>item.id===ids.companion).ownedDocuments[0].id,ids.story);
  const outgoing=path.join(f.root,'outgoing.zip'); await library.invoke('mobile_storage',{action:'exportArchive',workspaceId:work.id,path:outgoing});
  const parent=path.join(f.root,'restored'); await fs.mkdir(parent);
  const restored=JSON.parse((await runCommand(binary,['import',outgoing,parent])).stdout).root;
  assert.equal((await readWorldProjection(restored)).world.revision,result.revision);
  assert.deepEqual(await fs.readFile(path.join(restored,f.file)),await fs.readFile(path.join(f.root,f.file)));
});

test('relation planning runs in browser globals with no host APIs',async()=>{
  const result=await runCommand(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('world-portable-runtime.mjs',import.meta.url)),'--relations']);
  assert.deepEqual(JSON.parse(result.stdout),{kind:'references',largeNumberPreserved:true,unchanged:true});
});
