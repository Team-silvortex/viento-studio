// Read-only final audit after docs synchronization and standard atlas generation.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url)),dir=fileURLToPath(new URL('./',import.meta.url));
const json=async name=>JSON.parse(await fs.readFile(path.join(dir,name),'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
const result=await json('results.json'),baseline=await json('atlas-baseline.json'),atlas=JSON.parse(await fs.readFile(path.join(root,'docs/function-atlas.json'))),prefix={};
for(const key of ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities']){assert.deepEqual(atlas[key].slice(0,baseline[key].length),baseline[key]);prefix[key]=true;}
for(const key of Object.keys(baseline.axes)){assert.deepEqual(atlas.axes[key].slice(0,baseline.axes[key].length),baseline.axes[key]);prefix['axes.'+key]=true;}
const preservation={};for(const name of ['historical-baseline','frozen-backend-baseline','rust-source-baseline','source-hashes']){const entries=await json(name+'.json'),bad=[];for(const[file,h]of Object.entries(entries))if(sha(await fs.readFile(path.join(root,file)))!==h)bad.push(file);assert.deepEqual(bad,[]);preservation[name]={files:Object.keys(entries).length,mismatches:bad};}
for(const[file,h]of Object.entries(atlas.sourceSnapshot))assert.equal(sha(await fs.readFile(path.join(root,file))),h,'Atlas source changed '+file);
assert.equal((await fs.readFile(path.join(root,'VERSION'),'utf8')).trim(),'0.0.8');assert.equal(result.sourceVersion,'0.0.8');
const app=await fs.readFile(path.join(dir,'app-check.log'),'utf8');for(const [key,value]of [['tests',1962],['pass',1962],['fail',0],['skipped',0],['cancelled',0]])assert.equal(Number([...app.matchAll(new RegExp(`^ℹ ${key} (\\d+)$`,'gm'))].at(-1)?.[1]),value);
assert.equal(result.application.tests,1962);assert.equal(result.newRegressionTests.total,60);assert.equal(result.preservation.productAndTestHashes,513);
const cleanup=await json('cleanup.json');for(const item of cleanup.directories)await assert.rejects(fs.stat(path.isAbsolute(item.path)?item.path:path.join(root,item.path)),{code:'ENOENT'});
const docs=await json('docs-check.json'),atlasCheck=await json('atlas-check.json'),prefixCheck=await json('atlas-prefix-check.json');assert.ok(docs.ok&&atlasCheck.ok&&prefixCheck.ok);
const output={ok:true,recordedAt:new Date().toISOString(),sourceVersion:'0.0.8',delivery:'unreleased-working-tree',oldAtlasPrefixPreserved:prefix,preservation,atlasFingerprintFiles:Object.keys(atlas.sourceSnapshot).length,currentApplicationTests:result.application.tests,newTestsIncluded:result.newRegressionTests.total,browserJobs:result.browser.jobs,preparedRuntimeSessions:result.prepared.counts.runtimeSessions,batchReceipts:result.prepared.counts.batchReceipts,nativeFullMigrations:result.archive.fullNativeMigrations,generatedDirectoriesAbsent:true,freedAllocatedBytes:cleanup.freedAllocatedBytes,docsAndAtlasChecksPassed:true,readOnlyVerification:true};
await fs.writeFile(path.join(dir,'final-check.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
