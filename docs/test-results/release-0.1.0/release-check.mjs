import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const root='/home/chiharukiryu/cdev/viento-studio';
const out=path.join(root,'docs/test-results/release-0.1.0');
await fs.mkdir(out,{recursive:true});
const execute=promisify(execFile), hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const {verifyReleaseVersions,installerVersions}=await import(pathToFileURL(path.join(root,'desktop/version.mjs')));
const {collectFiles}=await import(pathToFileURL(path.join(root,'scripts/lib/scan-files.mjs')));
const {runDocApiContractPreflight}=await import(pathToFileURL(path.join(root,'scripts/lib/verify-doc-api-contract.mjs')));
process.chdir(root);
const release=await verifyReleaseVersions();
if(release.version!=='0.1.0')throw Error('Wrong release version');
const files=(await Promise.all(['engine','scripts','web','mobile'].map(directory=>collectFiles(directory,{
  relativeBase:directory,excludedRoots:['mobile/dist'],isAccepted:name=>/\.(?:mjs|js)$/.test(name),
})))).flat();
let cursor=0;
await Promise.all(Array.from({length:4},async()=>{
  while(cursor<files.length)await execute(process.execPath,['--check',files[cursor++]],{cwd:root});
}));
await runDocApiContractPreflight();
const testFiles=['scripts/tests/version.test.mjs','scripts/tests/source-archive.test.mjs'];
const result=await execute(process.execPath,['--test','--test-reporter=tap',...testFiles],{
  cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},maxBuffer:8*1024*1024,
}).catch(async error=>{await fs.writeFile(path.join(out,'version-source-tests.log'),(error.stdout||'')+(error.stderr||''));throw error;});
await fs.writeFile(path.join(out,'version-source-tests.log'),result.stdout+result.stderr);
const count=name=>Number(result.stdout.match(new RegExp(`^# ${name} (\\d+)$`,'m'))?.[1]);
if(count('tests')!==8||count('pass')!==8||count('fail')!==0||count('skipped')!==0)throw Error('Unexpected release test result');
const report={ok:true,version:release.version,finishedAt:new Date().toISOString(),node:process.version,
  nodeSha256:hash(await fs.readFile(process.execPath)),syntaxFiles:files.length,versionAndApiPreflight:true,
  installer:installerVersions(release.version),tests:Object.fromEntries(['tests','pass','fail','skipped','cancelled'].map(name=>[name,count(name)])),
  testSources:Object.fromEntries(await Promise.all(testFiles.map(async file=>[file,hash(await fs.readFile(path.join(root,file)))]))),
  scope:'Release metadata and source archive regression, all JavaScript syntax and API contract preflight. No new full application, Rust, browser, hardware GPU, installer or device run.',
};
await fs.writeFile(path.join(out,'preflight.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
