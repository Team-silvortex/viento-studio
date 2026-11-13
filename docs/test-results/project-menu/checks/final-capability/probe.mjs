import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseProjectMenuItems} from '/home/chiharukiryu/cdev/viento-studio/engine/project-menu.mjs';
const directory='/tmp/viento-menu-parse-probe';
const rows=JSON.parse(await fs.readFile(directory+'/menu-parity-cases.json'));
for(const literal of ['2.2250738585072014e-308','1.2345678901234567e-300','0e9999','-0.000e9999','0e-9999']){
const items_json='[{"id":"r","label":"R","command":"restart","values":{"value":'+literal+'}}]';
let accepted=false;try{parseProjectMenuItems(items_json);accepted=true;}catch{}
rows.push({label:'final-number-'+literal,items_json,mode:'scene',accepted});}
const limitations=new Set(['number-5e-324','final-number-2.2250738585072014e-308','final-number-1.2345678901234567e-300']);
for(const row of rows){row.portableAccepted=row.accepted;row.expectedBackendAccepted=limitations.has(row.label)?false:row.portableAccepted;row.reason=limitations.has(row.label)?'godot-number-underflow':row.reason??null;}
await fs.writeFile(directory+'/menu-final-capability-cases.json',JSON.stringify(rows,null,2)+'\n');
const source=`extends "res://project-menu-runtime.gd"
func _ready() -> void:
\tsuper._ready()
\tvar cases = JSON.parse_string(FileAccess.get_file_as_string("res://menu-final-capability-cases.json"))
\tvar results: Array = []
\tfor row in cases:
\t\tvar accepted := menu_parse(row["items_json"], row["mode"]) != null
\t\tresults.append({"label":row["label"],"portableAccepted":row["portableAccepted"],"backendAccepted":accepted,"expectedBackendAccepted":row["expectedBackendAccepted"],"reason":row["reason"]})
\t\tassert(accepted == row["expectedBackendAccepted"])
\tprint("MENU_CAPABILITY_FINAL:" + JSON.stringify({"count":cases.size(),"results":results},"",true,true))
\tfinish_project()
`;
await fs.writeFile(directory+'/menu-final-capability.gd',source);
await fs.writeFile(directory+'/menu-final-capability.tscn','[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://menu-final-capability.gd" id="1"]\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n');
const executable='/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-viento-audiofix1/linux-x86_64/Godot_v4.7.2-viento-audiofix1_linux.x86_64';
const run=spawnSync(executable,['--path',directory,'--headless','res://menu-final-capability.tscn'],{env:{...process.env,XDG_DATA_HOME:directory+'/xdg/data',XDG_CONFIG_HOME:directory+'/xdg/config',XDG_CACHE_HOME:directory+'/xdg/cache'},encoding:'utf8',timeout:15000});
await fs.writeFile('/tmp/viento-menu-native-capability-final.log',run.stdout+run.stderr);
const row=run.stdout.split('\n').find(x=>x.startsWith('MENU_CAPABILITY_FINAL:'));if(!row)throw Error(run.stdout+run.stderr);
const value=JSON.parse(row.slice('MENU_CAPABILITY_FINAL:'.length));
const result={scope:'Acceptance/rejection only. Common portable cases are distinguished from explicit Godot number-underflow capability refusals; no claim of universal numeric bit equality.',exitCode:run.status,runtimeSHA256:createHash('sha256').update(await fs.readFile(directory+'/project-menu-runtime.gd')).digest('hex'),count:value.count,commonCases:value.results.filter(x=>x.portableAccepted===x.backendAccepted).length,backendCapabilityRefusals:value.results.filter(x=>x.portableAccepted&&!x.backendAccepted),allExpected:value.results.every(x=>x.expectedBackendAccepted===x.backendAccepted),results:value.results};
await fs.writeFile('/tmp/viento-menu-native-capability-final.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({count:result.count,commonCases:result.commonCases,backendCapabilityRefusals:result.backendCapabilityRefusals.length,allExpected:result.allExpected,runtimeSHA256:result.runtimeSHA256}));
