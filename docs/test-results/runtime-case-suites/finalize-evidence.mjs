// Run only after final application, Chrome and prepared-resource checks finish.
// Delete only the seven generated paths recorded as absent at this round's start.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url)),evidence=fileURLToPath(new URL('./',import.meta.url));
const read=name=>fs.readFile(path.join(evidence,name),'utf8'),json=async name=>JSON.parse(await read(name)),write=(name,value)=>fs.writeFile(path.join(evidence,name),JSON.stringify(value,null,2)+'\n');
const hash=b=>createHash('sha256').update(b).digest('hex');
const log=await read('app-check.log'),stat=name=>Number([...log.matchAll(new RegExp(`^ℹ ${name} ([\\d.]+)$`,'gm'))].at(-1)?.[1]);
assert.equal(stat('tests'),1962);assert.equal(stat('pass'),1962);for(const key of ['fail','skipped','cancelled'])assert.equal(stat(key),0);
const browser=await json('browser/browser.json'),packaged=await json('packaged-resources.json');assert.equal(browser.ok,true);assert.equal(packaged.ok,true);
assert.equal(browser.locales.length,3);assert.deepEqual(browser.errors,[]);assert.equal(new Set(browser.jobs.map(j=>j.id)).size,browser.jobs.length);
assert.equal(packaged.counts.backends,2);assert.equal(packaged.counts.runtimeSessions,18);assert.equal(packaged.counts.batchReceipts,8);
const checks={};
for(const name of ['historical-baseline','frozen-backend-baseline','rust-source-baseline','source-hashes']){const entries=await json(name+'.json'),bad=[];for(const[file,expected]of Object.entries(entries))if(hash(await fs.readFile(path.join(root,file)))!==expected)bad.push(file);checks[name]={files:Object.keys(entries).length,mismatches:bad};assert.deepEqual(bad,[]);}
assert.equal(checks['historical-baseline'].files,1866);assert.equal(checks['source-hashes'].files,513);
await write('historical-preservation.json',{ok:true,recordedAt:new Date().toISOString(),checks,note:'All previous evidence, native/backend/WASM sources and final product/test hashes are preserved. Current source-hashes-initial is a starting snapshot, not a claim old product SHA remained unchanged.'});
for(const artifact of Object.values(packaged.artifacts))for(const[file,item]of Object.entries(artifact.hashes))assert.equal(hash(await fs.readFile(path.join(root,file))),item.sourceSha256,'Prepared source mismatch: '+file);
for(const[file,expected]of Object.entries(browser.sourceHashes))assert.equal(hash(await fs.readFile(path.join(root,file))),expected,'Browser source mismatch: '+file);
const baseline=await json('generated-baseline.json'),allowed=['desktop/resources','desktop/ui/i18n','desktop/.cache','src-tauri/binaries','mobile/dist','/tmp/viento-case-suites-native-target','/tmp/viento-case-suites-core-target'];
assert.deepEqual(Object.keys(baseline),allowed);assert.ok(Object.values(baseline).every(value=>value===false));
async function allocated(directory){let total=0;const seen=new Set();async function walk(file){const stat=await fs.lstat(file),key=stat.dev+':'+stat.ino;if(!seen.has(key)){seen.add(key);total+=stat.blocks*512;}if(stat.isDirectory())for(const name of await fs.readdir(file))await walk(path.join(file,name));}await walk(directory);return total;}
const directories=[];for(const input of allowed){const directory=path.isAbsolute(input)?input:path.join(root,input),bytes=await allocated(directory);await fs.rm(directory,{recursive:true,force:true});await assert.rejects(fs.stat(directory),{code:'ENOENT'});directories.push({path:input,initialExists:false,allocatedBytes:bytes,removed:true});}
const freedAllocatedBytes=directories.reduce((sum,item)=>sum+item.allocatedBytes,0);
await write('cleanup.json',{ok:true,recordedAt:new Date().toISOString(),directories,freedAllocatedBytes,freedGiB:freedAllocatedBytes/2**30,existingToolsUserDataPreferencesAndInstalledAppPreserved:true});
const report={format:'viento-runtime-case-suite-acceptance',schemaVersion:1,ok:true,recordedAt:new Date().toISOString(),sourceVersion:'0.0.8',sourceBaseCommit:'d36baad631550a99593efe388cf84aa238b79c5f',delivery:'unreleased-working-tree',changes:[
'Strict ordered stable-ID suite reuses registered case documents, shared scene dependencies and aggregate budgets before any engine task.',
'Shared atomic author service keeps exact bytes, scene/source CAS and publication rollback semantics for both cases and suites.',
'Node captures all members once then reuses existing headless execution in sequence; assertion failure continues, execution failure/cancel stops queued members and waits for reaping.',
'Owned-build admission rechecks prune races; each member pins the frozen build/snapshot and tool. Separate atomic suite receipts stay outside author files.',
'Independent three-language GUI edits explicit saved membership and renders host progress; CLI adds an exclusive registered UUID/path suite mode.',
'Selective packages derive suite/member/scene closure, reject known bad scenes even when members are declared requirements, and preserve UUID/raw source during path migration.'],
application:{tests:stat('tests'),passed:stat('pass'),failed:stat('fail'),skipped:stat('skipped'),cancelled:stat('cancelled'),durationMs:stat('duration_ms'),javascriptFiles:Number(log.match(/语法检查通过：(\d+) 个/)?.[1]),apiAndVersionPreflight:true,log:'app-check.log'},
newRegressionTests:{total:60,portableSuite:14,authorAndSchedulerHost:17,resourcePackages:14,suiteUi:14,http:1,includedInApplicationTotal:true,targetedChecksOverlapApplication:true},
browser:{browser:browser.browser,scenarios:browser.scenarios.length,localesAt390px:browser.locales.length,jobs:browser.jobs.length,runtimeExceptions:browser.errors.length,originalAuthorBytesUnchanged:browser.originalAuthorBytesUnchanged,newRegisteredDocuments:browser.newRegisteredDocuments,newAuthorAndMetadataFiles:browser.newAuthorAndMetadataFiles,draftAndCaretPreserved:browser.draftAndCaretPreserved,evidence:'browser/browser.json',reproduction:'browser-check.mjs',visuallyInspected:['browser/zh-CN-390.png','browser/en-390.png','browser/ja-390.png'],screenshotScope:'Three-language narrow layout and visible 2/3 progress, terminal facts verified in browser JSON'},
prepared:{embeddedNode:packaged.embeddedNode,desktopFullManifestFiles:packaged.artifacts['desktop/resources'].manifestFileCount,desktopFocusedSourceChecks:packaged.artifacts['desktop/resources'].checkedSourceFiles,mobileFullManifestFiles:packaged.artifacts['mobile/dist'].manifestFileCount,mobileFocusedSourceChecks:packaged.artifacts['mobile/dist'].checkedSourceFiles,counts:packaged.counts,mobilePortable:packaged.mobileChecks,evidence:'packaged-resources.json',reproduction:'packaged-check.mjs'},
tools:packaged.externalTools,native:{freshBuiltAndUsed:true,offlineLocked:true,rustSourcesUnchanged:19,standaloneRustTestsRerun:false,proof:'native-helpers-proof.json'},archive:{fullNativeMigrations:packaged.desktopChecks.length,standardAuthorDataRootsOnly:true,rootReadmeOutsideArchive:true,authorBytesAndStableIdentitiesPreserved:true},
preservation:{historicalFiles:1866,frozenBackendAndWasmFiles:9,rustSources:19,productAndTestHashes:513,evidence:'historical-preservation.json'},cleanup:{directories:directories.length,freedAllocatedBytes,freedGiB:freedAllocatedBytes/2**30,evidence:'cleanup.json'},
retainedInitialChecks:[{log:'suite-package-check-initial.log',tests:14,passed:13,failed:1,reason:'Real reader gap: included invalid scene skipped structural validation when all members were deferred as declared requirements. Shared scene dependency validation now rejects it at read, and targeted/full tests pass.'},
{log:'package-regressions.log',tests:64,passed:60,failed:0,skipped:4,reason:'Existing native environment-gated neighbors in targeted run. Final full application supplies real engines and native helpers with zero skips.'},
{log:'browser-check-initial.log',result:'failed',reason:'Editor remained uninitialized; the subsequent instrumented browser run diagnosed the real transitive YAML static dependency 404. Initial script/log/report retained.'},
{log:'browser-check-second.log',result:'failed',reason:'Instrumented browser proved new suite UI imported author CST/YAML through suite module, triggering /node_modules/yaml 404 under the existing HTTP boundary. Lightweight contract entry now shares the same structural validator/summary without importing source parsing.'},
{log:'app-check-initial.log',tests:1960,passed:1959,failed:1,skipped:0,reason:'Existing HTTP browser module-graph regression independently caught the same transitive YAML 404. Final checks rerun after the contract/UI boundary fix.'},
{log:'packaged-check-initial.log',result:'passed',reason:'Initial prepared desktop suites/native migration passed, but this was not editor UI acceptance. Final resources and dual-engine/mobile proof regenerated after the browser import boundary fix.'},
{log:'browser-check-third.log',result:'failed',reason:'The probe expected terminal workbench buttons to reflect an external source rename without refreshing the parent state. Final browser proof explicitly refreshes/reopens before checking the offline guard; admission remained refused by the host.'},
{log:'node-download.log',result:'failed',reason:'Pinned official Node archive TLS failed through the current route; identical mirror archive was accepted only after matching the official pinned SHA. Normal preparation uses the same original archive and license.'},
{log:'node-download-alternate.log',result:'failed',reason:'Official alternate release URL with TLS1.2 also failed; mirror verification and final embedded Node SHA are recorded.'}],
limits:['Unreleased 0.0.8 working tree; no new version, commit/push, installer, installed Tauri, tag, Release or Android host/device execution.',
'Native/core/backend/WASM and old author/control/trace formats unchanged; fresh helpers built and used, standalone Rust tests not rerun.',
'Only stable UUID migration; no UUID clone rewrite, nested/parallel suites, automatic expected-value updates or author script assertions.',
'Every admitted suite requires fresh author source; existing individual frozen offline runs retain their prior behavior. Mobile only portable data checks.']};
await write('results.json',report);console.log(JSON.stringify({ok:true,application:report.application,prepared:report.prepared.counts,freedGiB:report.cleanup.freedGiB}));
