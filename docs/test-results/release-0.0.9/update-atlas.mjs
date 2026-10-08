import fs from'node:fs/promises';import assert from'node:assert/strict';
const dir='docs/test-results/release-0.0.9',file='docs/function-atlas.json',data=JSON.parse(await fs.readFile(file)),baseline=JSON.parse(await fs.readFile(dir+'/atlas-baseline.json')),r=JSON.parse(await fs.readFile(dir+'/results.json'));
assert.deepEqual(data,baseline);
const features=new Set(['execution.tool_identity','runtime.verification_cases','runtime.case_documents','runtime.case_suites','runtime.case_reports']);
const entries=[['design','docs/RELEASE_0.0.9.md','0.0.9源码交付范围和旧安装/设备边界'],['report',dir+'/results.json','新版本固定Node/双引擎/nativehelpers完整应用及准备副本/归档实际范围'],['report',dir+'/packaged-resources.json','0.0.9实际双引擎memberreports和mobilepure，不升级旧专题版本'],['report',dir+'/prepared-manifests.json','桌面/作品库/移动完整准备清单和版本'],['report',dir+'/source-archive.json','实际验收时源码快照，非最终提交ZIP交付'],['report',dir+'/historical-preservation.json','2017既有证据和9冻结原字节，旧nativeRust源保持'],['report',dir+'/source-hashes.json','最终0.0.9产品/测试/版本527SHA'],['report',dir+'/cleanup.json','只清理7本轮初始不存在生成路径及源码探针自己的暂存归档']];
const ids=[];for(const[kind,path,note]of entries){await fs.access(path);const id='e'+String(data.evidence.length+1).padStart(3,'0');data.evidence.push({id,kind,path,note});ids.push(id);}
let changed=0;
for(const f of data.axes.function)if(features.has(f.id)){assert.equal(f.delivery,'working-tree');f.delivery='source-release';f.boundary[0]='0.0.9源码交付；原0.0.8阶段协议与边界保留。'+f.boundary[0];f.platforms=f.platforms.map(value=>value.startsWith('未发布版本')?'0.0.9源码交付；未验收新安装/设备。':value);}
for(const b of data.bindings)if(features.has(b.function)){b.evidence.push(...ids);const cell=data.cells.find(c=>c.coordinates.join('|')===[b.architecture,b.function,b.implementation,'delivery'].join('|'));assert.equal(cell.value,2);cell.value=3;cell.reason='纳入0.0.9源码交付与发布候选检查；未交付新安装包、图形宿主或Android设备验收。';changed++;}
assert.equal(changed,31);
data.meta.scope=`0.0.9源码交付：纳入工具身份、运行验收用例、作者文档、有序组和独立成员报告，31delivery单元2→3，其他成熟度与坐标保持。新版本固定Node24.20.0实际app${r.application.passed}/${r.application.tests}、0fail/skip/cancel、${r.application.javascriptFiles}JS/API/version；prepared2引擎5批次9会话9报告、mobile仅pure，源码ZIP为审计前临时快照，完整范围见release09results。2017历史/9冻结/19Rust字节保持，本轮生成物清理；不重标旧Chrome/专题/Rust证据，不制作新安装/Android验收。此前范围原样保留：`+data.meta.scope;
data.meta.version=r.sourceVersion;
await fs.writeFile(file,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify({ok:true,sourceRelease:'0.0.9',featureCount:features.size,deliveryCellsUpdated:changed,newEvidence:ids.length}));
