import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2] || '.');
const imp=name=>import(pathToFileURL(path.join(root,name)));
const {collectFiles}=await imp('scripts/lib/scan-files.mjs');
const files=(await Promise.all(['engine','scripts','web','mobile'].map(async dir=>(await collectFiles(path.join(root,dir),{isAccepted:n=>/\.(?:mjs|js)$/.test(n),excludedRoots:[path.join(root,'mobile/dist')]})).map(n=>dir+'/'+n)))).flat().sort();
for(const name of files){const r=spawnSync(process.execPath,['--check',path.join(root,name)],{encoding:'utf8'});if(r.status!==0)throw Error(name+'\n'+r.stderr);}
const api=await(await imp('scripts/lib/verify-doc-api-contract.mjs')).runDocApiContractPreflight();
const version=await(await imp('desktop/version.mjs')).verifyReleaseVersions(root);
await fs.writeFile(path.resolve(process.argv[3] || 'preflight.json'),JSON.stringify({ok:true,node:process.version,syntaxFiles:files.length,files,api,version},null,2)+'\n');
console.log(JSON.stringify({ok:true,syntaxFiles:files.length,api,version}));
