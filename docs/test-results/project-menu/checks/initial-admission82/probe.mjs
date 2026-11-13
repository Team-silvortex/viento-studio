import fs from 'node:fs/promises';
import {parseProjectMenuItems} from '/home/chiharukiryu/cdev/viento-studio/engine/project-menu.mjs';
const cases=[],scene='dddddddd-dddd-4ddd-8ddd-dddddddddddd',target='00000002-1111-4111-8111-111111111111';
const add=(label,items,mode='scene')=>cases.push({label,items_json:typeof items==='string'?items:JSON.stringify(items),mode});
const item=(values)=>[{id:'restart',label:'Again',command:'restart',values}];
add('finish',[{id:'exit',label:'終了 / Exit / 退出',command:'finish'}]);
add('scene',[{id:'start',label:'Start',command:'scene',targetSceneId:target}]);
add('retry-default',[{id:'retry',label:'Retry',command:'retry',targetSceneId:target}]);
add('resume',[{id:'resume',label:'Resume',command:'resume'}],'paused');
add('paused-restart',[{id:'restart',label:'Restart',command:'restart'}],'paused');
add('scene-resume',[{id:'resume',label:'Resume',command:'resume'}]);
for(const literal of ['1','1.0','1e0','-0','1e-300','5e-324','0.000001','1e-7','0.30000000000000004','1.2345678901234567','1000000000','1000000001','1e309','01','+1','.1','1.','1e'])add('number-'+literal,'[{"id":"r","label":"R","command":"restart","values":{"value":'+literal+'}}]');
add('payload4096',item({a:'x'.repeat(4095)}));add('payload4097',item({a:'x'.repeat(4096)}));
add('unicode4096',item({a:'中'.repeat(1365)}));add('unicode4097',item({aa:'中'.repeat(1365)}));
add('16keys',item(Object.fromEntries(Array.from({length:16},(_,i)=>['k'+i,i]))));add('17keys',item(Object.fromEntries(Array.from({length:17},(_,i)=>['k'+i,i]))));
add('empty-value',item({empty:''})); add('boolean-values',item({a:true,b:false}));add('quote-slash',item({text:'"\\/中😀'}));
for(const scalar of [0,1,8,9,10,11,12,13,31,127,128,159]){
 add('escaped-control-'+scalar,item({text:String.fromCodePoint(scalar)}));
 if(scalar>=32)add('raw-control-'+scalar,'[{"id":"r","label":"R","command":"restart","values":{"text":"'+String.fromCodePoint(scalar)+'"}}]');
 add('unicode-control-'+scalar,'[{"id":"r","label":"R","command":"restart","values":{"text":"\\u'+scalar.toString(16).padStart(4,'0')+'"}}]');
}
for(const suffix of ['',',"extra":true',',"command":"restart"',',"\\u0063ommand":"restart"']) add('fields-'+suffix,'[{"id":"r","label":"R","command":"restart"'+suffix+'}]');
add('trailing-comma','[{"id":"r","label":"R","command":"restart",}]');add('trailing-array-comma','[{"id":"r","label":"R","command":"restart"},]');
add('duplicate-values','[{"id":"r","label":"R","command":"restart","values":{"a":1,"\\u0061":2}}]');
add('unicode160',[{id:'r',label:'中'.repeat(160),command:'restart'}]);add('unicode161',[{id:'r',label:'中'.repeat(161),command:'restart'}]);
add('emoji160',[{id:'r',label:'😀'.repeat(160),command:'restart'}]);add('high-surrogate','[{"id":"r","label":"\\ud800","command":"restart"}]');
add('unknown-target',[{id:'r',label:'R',command:'scene',targetSceneId:'00000003-1111-4111-8111-111111111111'}]);
add('same-target',[{id:'r',label:'R',command:'scene',targetSceneId:scene}]);
add('null-value',item({a:null})); add('nested-array',item({a:[]}));
const basic='[{"id":"r","label":"R","command":"restart"}]';
add('items8192',basic+' '.repeat(8192-basic.length));add('items8193',basic+' '.repeat(8193-basic.length));
add('format-whitespace',' \n [\n  {"id":"r",\n "label":"R", "command":"restart"}\n ]\n');
for(const token of ['+041','-041','G041','0x41'])add('invalid-unicode-'+token,'[{"id":"r","label":"\\u'+token+'","command":"restart"}]');
for(const row of cases){try{parseProjectMenuItems(row.items_json,{displayMode:row.mode,sceneIds:[scene,target],currentSceneId:scene});row.accepted=true;}catch(error){row.accepted=false;row.reason=error.reason;}}
await fs.writeFile('/tmp/viento-menu-parse-probe/menu-parity-cases.json',JSON.stringify(cases,null,2)+'\n');console.log('cases',cases.length,'accept',cases.filter(x=>x.accepted).length);
