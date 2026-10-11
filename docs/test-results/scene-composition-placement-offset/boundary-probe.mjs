import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { runPlacementCases,sha } from './boundary-cases.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),e=fileURLToPath(new URL('./',import.meta.url));
assert.equal(process.version,'v24.20.0');assert.equal(sha(await fs.readFile(process.execPath)),'89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7');
const manifests=JSON.parse(await fs.readFile(path.join(e,'core-source-hashes.json'),'utf8'));
async function frozen(){for(const[file,digest]of Object.entries(manifests))assert.equal(sha(await fs.readFile(path.join(root,file))),digest,`Core changed: ${file}`);}
await frozen();await import(pathToFileURL(path.join(root,'scripts/adapters/node-studio-core.mjs')));
const modules=['engine/scene-composition-placement.mjs','engine/scene-composition.mjs','engine/scene-structure.mjs','engine/studio-core.mjs'];
const api=Object.assign({},...await Promise.all(modules.map(file=>import(pathToFileURL(path.join(root,file))))));
const example=JSON.parse(await fs.readFile(path.join(root,'examples/scene-composition/recipe.json'),'utf8'));
const checks=await runPlacementCases(api,example);await frozen();
const report={ok:true,recordedAt:new Date().toISOString(),scope:'Independent current-source placement offset set/delete helper proof with the actual fresh Rust WASM and synthetic valid effective previews. No live projection/resource dependency, source persistence, GUI, prepared-copy, installation or device acceptance.',
 runtime:{version:process.version,sha256:sha(await fs.readFile(process.execPath))},coreSourceSha256:manifests,cases:checks,
 probeSha256:sha(await fs.readFile(fileURLToPath(import.meta.url))),caseHarnessSha256:sha(await fs.readFile(path.join(e,'boundary-cases.mjs')))};
await fs.writeFile(path.join(e,'boundary-probe.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({ok:true,cases:checks.length,rejectedOperations:checks.reduce((sum,item)=>sum+(item.rejectedOperations||0),0),runtime:report.runtime}));
