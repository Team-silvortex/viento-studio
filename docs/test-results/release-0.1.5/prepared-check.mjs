#!/usr/bin/env node
// Run after desktop --resources-only and mobile preparation, never during them.
// Copies historical runners to the new release report; old evidence is read only.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=path.resolve(process.argv[2]);
const version='0.1.5';
const out=path.join(root,'docs/test-results/release-0.1.5');
const hash=b=>createHash('sha256').update(b).digest('hex');
const load=p=>import(pathToFileURL(path.join(root,p)).href);
const report={ok:false,version,checkedAt:new Date().toISOString(),comparisons:[],calls:[],allDesktopFiles:[],
  scope:'Prepared desktop/mobile source copies and actual module calls at release 0.1.5. The two historical verification runners are copied with only their output filenames changed; their original reports remain untouched. Runners use real core WASM and injected audio-clock/device or document-state dependencies. This is not installer, actual audio-device, engine-rendering, or Android endpoint acceptance. Runner scopes overlap; counts are not independent tests.'};
assert.equal((await fs.readFile(path.join(root,'VERSION'),'utf8')).trim(),version);
assert.deepEqual(await (await load('desktop/version.mjs')).verifyReleaseVersions(),{version,buildVersion:version});
await fs.mkdir(out,{recursive:true});
const generatedPackage=JSON.parse(await fs.readFile(path.join(root,'desktop/resources/package.json'),'utf8'));
assert.deepEqual(generatedPackage,{private:true,type:'module',version,displayVersion:version});
assert.equal((await fs.readFile(path.join(root,'desktop/resources/VERSION'),'utf8')).trim(),version);
for(const [file,kind] of [['mobile/dist/index.html','mobile library'],['mobile/dist/editor.html','mobile editor']]){
  const html=await fs.readFile(path.join(root,file),'utf8');
  const displayed=kind==='mobile library'?html.match(/<h1>Viento Studio<\/h1><span>([^<]+)<\//)?.[1]
    :html.match(/id="appVersion"[^>]*>([^<]+)</)?.[1];
  assert.equal(displayed,version,kind);
  assert.equal(html.includes('__VIENTO_VERSION__'),false,kind);
  report.comparisons.push({file,sha256:hash(html),displayVersion:version});
}
for(const file of ['en.js','ja.js']){
  const source=await fs.readFile(path.join(root,'web/i18n',file));
  const copy=await fs.readFile(path.join(root,'desktop/ui/i18n',file));
  assert.deepEqual(copy,source);
  report.comparisons.push({file:'desktop/ui/i18n/'+file,sha256:hash(source)});
}
for(const [topic,name] of [['scene-audio-audition-transport','audition-transport'],['scene-behavior-audio-picker','behavior-audio-picker']]){
  const original=path.join(root,'docs/test-results',topic,'prepared-runner.mjs');
  const bytes=await fs.readFile(original),source=bytes.toString('utf8');
  assert.equal(source.split("'prepared.json'").length,2,'runner output must be uniquely adapted');
  const copiedName='prepared-'+name+'-runner.mjs',outputName='prepared-'+name+'.json';
  const adapted=source.replace("'prepared.json'",JSON.stringify(outputName));
  await fs.writeFile(path.join(out,copiedName),adapted);
  const stdout=execFileSync(process.execPath,[path.join(out,copiedName)],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
  await fs.writeFile(path.join(out,'prepared-'+name+'.log'),stdout);
  const result=JSON.parse(await fs.readFile(path.join(out,outputName),'utf8'));
  assert.equal(result.ok,true);
  assert.equal(result.calls.length,3);
  assert.deepEqual(await fs.readFile(original),bytes,'historical runner must remain unchanged');
  report.calls.push({topic,copiedRunner:copiedName,output:outputName,originalSha256:hash(bytes),adaptedSha256:hash(adapted),
    adaptation:'Only prepared.json output filename changes; relative source-root resolution stays valid.',
    comparisons:result.comparisons.length,moduleCalls:result.calls.length,desktopDirectoryService:result.desktopDirectoryService===true});
}
// Audit every prepared desktop file so cleanup can later remove this exact,
// reproducible copy only when the root agent's baseline says it was absent.
const runtime=JSON.parse(await fs.readFile(path.join(root,'desktop/node-runtime.json'),'utf8'));
async function walk(directory){
  const result=[];
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const target=path.join(directory,entry.name);
    assert.equal(entry.isSymbolicLink(),false,'unexpected prepared symlink: '+target);
    if(entry.isDirectory())result.push(...await walk(target));
    else{assert.equal(entry.isFile(),true);result.push(target);}
  }
  return result;
}
for(const absolute of (await walk(path.join(root,'desktop/resources'))).sort()){
  const relative=path.relative(path.join(root,'desktop/resources'),absolute).split(path.sep).join('/');
  const bytes=await fs.readFile(absolute);let source=relative;
  if(relative==='package.json'){
    assert.deepEqual(JSON.parse(bytes.toString()),generatedPackage);source='generated from verified release version';
  }else if(relative==='NODE-LICENSE'){
    const expected=await fs.readFile(path.join(root,'desktop/.cache',runtime.version+'-LICENSE'));
    assert.deepEqual(bytes,expected);assert.equal(hash(bytes),runtime.licenseSha256);source='desktop/.cache/'+runtime.version+'-LICENSE';
  }else{
    assert.deepEqual(bytes,await fs.readFile(path.join(root,relative)),'prepared file differs: '+relative);
  }
  assert.equal(relative.split('/').includes('.viento'),false,'workspace state leaked');
  assert.equal(relative.startsWith('scripts/tests/'),false,'test suite leaked');
  assert.equal(relative.startsWith('scripts/backends/bevy-rust/target/'),false,'build cache leaked');
  report.allDesktopFiles.push({path:relative,source,size:bytes.length,sha256:hash(bytes)});
}
assert.equal(report.allDesktopFiles.length>600,true);
await assert.rejects(fs.stat(path.join(root,'mobile/dist/node_modules')),{code:'ENOENT'});
await assert.rejects(fs.stat(path.join(root,'mobile/dist/scripts/lib/scene-audio-directory-service.mjs')),{code:'ENOENT'});
report.desktopResources={files:report.allDesktopFiles.length,bytes:report.allDesktopFiles.reduce((n,x)=>n+x.size,0),allBytesCompared:true};
report.mobileNodeAndDirectoryServiceExcluded=true;
report.ok=true;
await fs.writeFile(path.join(out,'prepared.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,version,copiedRunners:report.calls.length,moduleCalls:report.calls.reduce((n,c)=>n+c.moduleCalls,0),
  runnerComparisons:report.calls.map(c=>({topic:c.topic,comparisons:c.comparisons})),allDesktopFiles:report.allDesktopFiles.length,desktopBytes:report.desktopResources.bytes}));
