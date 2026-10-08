import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url)),dir=fileURLToPath(new URL('./',import.meta.url));
const data=JSON.parse(await fs.readFile(path.join(root,'docs/function-atlas.json'))),baseline=JSON.parse(await fs.readFile(path.join(dir,'atlas-baseline.json'))),report=JSON.parse(await fs.readFile(path.join(dir,'results.json')));
for(const key of ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities'])assert.deepEqual(data[key],baseline[key]);
for(const key of Object.keys(baseline.axes))assert.deepEqual(data.axes[key],baseline.axes[key]);
const feature='runtime.case_suites';
data.axes.function.push({id:feature,label:'同场景有序验收组与宿主批次调度',group:'场景与构建',entry:'已保存用例→按顺序选入/保存组→owned suite-run→成员结果/取消；CLI --runtime-suite',boundary:[
'0.0.8之后未发布工作树；组与用例正文分开，原控制/trace/作者场景/plan/adapter/native/WASM保持。',
'严格四字段viento-runtime-case-suite schema1，16KiB、1–16同场景注册JSON成员、稳定UUID有序不重复；actor×总steps≤4096/总checks≤1024，全部预检后才分配job。',
'共享场景准入在成员正文延期时仍检查包内已知scene，reader只声明requirements缺正文延期，import真实目标再核验；完整迁移/路径变化保持原字节与UUID。',
'共享作者writer复用原登记锁、原子正文、source/scene SHA与publication guards；fresh组/成员来源，GUI显式保存/载入/另存，未知回执阻止重复写。',
'Node一次捕获所有成员与版本，逐成员复用现有headless executor，每份再检查frozen build/snapshot/tool；等待时被prune的owner在job前拒绝。',
'断言failed继续，进程/协议失败、timeout/cancel停余项为not-run；保持partial samples，等待reap释放唯一slot；final committed结果不被迟到cancel重写。',
'独立suite缓存原子receipt记录顺序/版本/session/counts，执行status与汇总status分开；GUI不启动队列、不从suite last samples生成单case。',
'真实Linux Chrome及prepared Node/Godot/Bevy/native archive限定验证；mobile仅pure数据，不是Android执行/安装验收。'],next:'分别定义更丰富状态检查、作者行为、嵌套或并行组；不推导自动更新预期、UUID克隆或引擎脚本互译。',platforms:['Linux本机workbench/Node/CLI可信Godot与Bevy','纯规则可准备到移动资源；不含Android引擎宿主','未发布版本或验收安装/设备'],delivery:'working-tree'});
const impls=[
['i136','runtime-case-suite.mjs：纯组准入、依赖、联合预算与汇总',['engine/runtime-case-suite-contract.mjs','engine/runtime-case-suite.mjs']],
['i137','runtime-author-documents / runtime-case-suites：共享作者守护与整批捕获',['scripts/lib/runtime-author-documents.mjs','scripts/lib/runtime-case-suites.mjs']],
['i138','node-runtime-case-suite.mjs：复用有限会话的宿主顺序调度',['scripts/adapters/node-runtime-case-suite.mjs']],
['i139','app-runtime-case-suites.js：独立组编辑与进度展示',['web/modules/app-runtime-case-suites.js']]];
for(const[id,label,paths]of impls)data.axes.implementation.push({id,label,kind:'product',language:['JavaScript'],paths});
const evidence=[
['source','engine/runtime-case-suite-contract.mjs','浏览器轻量结构校验/汇总入口，不加载作者CST或YAML；主模块重导出同规则'],
['source','engine/runtime-case-suite.mjs','纯组成员/依赖/plan预算/汇总，无I/O或引擎'],
['source','scripts/lib/runtime-author-documents.mjs','抽取原作者保存机制，共享精确字节和双修订发布检查'],
['source','scripts/lib/runtime-case-suites.mjs','fresh组目录/保存与一次完整member capture'],
['source','scripts/adapters/node-runtime-case-suite.mjs','顺序旧会话、取消reap、atomicreceipt、逐成员冻结身份'],
['source','web/modules/app-runtime-case-suites.js','三语独立组编辑/未知回执/进度，不调度引擎'],
['test','scripts/tests/runtime-case-suite.test.mjs','14纯组/坏场景延期/预算边界/浏览器入口同规则回归'],
['test','scripts/tests/runtime-case-suite-host.test.mjs','17作者/顺序/取消/超时/冻结替换/准入prune回归'],
['test','scripts/tests/runtime-case-suite-packages.test.mjs','14闭包/requirements/读包/target复核/路径稳定迁移'],
['test','scripts/tests/runtime-case-suite-ui.test.mjs','14顺序/草稿/迟到保存/三语/结果与限制/浏览器模块边界回归'],
['test','scripts/tests/project-build-http.test.mjs','新增suite鉴权/原字节CAS与无工具作者保存；旧HTTP真实Godot重跑'],
['design','docs/RUNTIME_CASE_SUITES.md','有序组操作、预算、结果与宿主边界'],
['report','docs/test-results/runtime-case-suites/results.json','本轮真实应用/浏览器/prepared/nativearchive范围和保留的初次失败'],
['report','docs/test-results/runtime-case-suites/browser/browser.json','真实Chrome隔离工程、组执行与取消、三语390/作者字节'],
['report','docs/test-results/runtime-case-suites/packaged-resources.json','pinnedNode桌面双引擎组/CLI/nativearchive，mobile只pure数据'],
['report','docs/test-results/runtime-case-suites/source-hashes.json','最终产品与测试SHA，报告与atlas排除避免循环'],
['report','docs/test-results/runtime-case-suites/historical-preservation.json','1866历史/9frozen/19Rust原字节保持'],
['report','docs/test-results/runtime-case-suites/cleanup.json','仅7个本轮初始不存在生成目录清理'],
['report','docs/test-results/runtime-case-suites/native-helpers-proof.json','fresh offline locked原生helper用于本轮，不重跑独立Rust测试']];
const ids=[];for(const[kind,p,note]of evidence){const id='e'+String(data.evidence.length+1).padStart(3,'0');data.evidence.push({id,kind,path:p,note});ids.push(id);}
const bindings=[['semantic-js','i136','组成员、共享场景准入、联合预算与独立结果汇总'],['semantic-js','i133','沿用原用例绑定及抽出的共享场景依赖检查'],['node-service','i137','复用原作者原子保存和修订保护，一次捕获全体成员'],['node-service','i138','宿主顺序旧无头会话、取消等待退出和独立回执'],['node-service','i120','构建/快照共同验证与owner准入复查，旧后端执行器不改'],['persistence','i040','组→成员→场景闭包、requirements/目标字节核验与路径稳定迁移'],['ui','i139','显式有序成员/保存/载入/另存及批次结果，保留未知回执状态'],['ui','i076','父工作台只调用宿主批次与状态轮询，单case生成严格区分'],['quality','i126','CLI互斥组模式，注册UUID/相对path与可信工具边界']];
for(const[architecture,implementation,role]of bindings){const id='b'+String(data.bindings.length+2).padStart(3,'0');data.bindings.push({id,architecture,function:feature,implementation,role,evidence:ids});
 for(const[maturity,value,reason]of [['implementation',3,'同场景有序验收主链接通；嵌套/并行与更广作者行为待定义。'],['verification',3,'纯规则/作者/HTTP/包/UI及实际Chrome/prepared双引擎/native迁移有本轮限定证据；安装与设备独立。'],['decoupling',4,'组规则、作者捕获、宿主旧会话调度和GUI进度分开，无新backend协议或源码互译。'],['delivery',2,'0.0.8之后未发布工作树与准备副本；未发布新版本或安装产物。']])data.cells.push({coordinates:[architecture,feature,implementation,maturity],value,reason});}
for(const[to,reason]of [['runtime.case_documents','成员复用原稳定身份包装与作者修订。'],['build.snapshot_plan','全部成员对同scene已验证frozen plan2准入，每成员重查冻结身份。'],['execution.backend_middleware','可信宿主顺序复用原headless/control executor与tool。'],['resource.package','组依赖闭包/声明requirements/target复核与标准完整迁移。']])data.dependencies.push({from:feature,to,relation:'requires',reason});
data.workflows.push({id:'runtime-case-suites',label:'保存用例→有序组→全部准入→顺序执行/取消→独立汇总',steps:['runtime.case_documents',feature,'build.snapshot_plan','execution.backend_middleware','runtime.verification_cases','resource.package'],boundary:'先fresh捕获全部作者成员再分配owner；assertion fail继续/executionfail或cancel停余项，reap释放；mobile只pure、不升级安装/设备或旧评分。'});
data.meta.scope=`本轮有序验收组 app${report.application.passed}/${report.application.tests}、0fail/skip/cancel、${report.application.javascriptFiles}JS；新增${report.newRegressionTests.total}已计入全量。Chrome与prepared双引擎/nativearchive实际范围见新results，mobile仅pure；1866历史/9frozen/19Rust/${report.preservation.productAndTestHashes}产品测试SHA保持，仅清理7本轮新增目录。新增runtime.case_suites及9binding 3/3/4/2，旧坐标/评分/工作流前缀保持，无新版本/提交/安装/Android执行。此前范围原样保留：`+data.meta.scope;
await fs.writeFile(path.join(root,'docs/function-atlas.json'),JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({ok:true,newFunction:feature,newBindings:bindings.length,newEvidence:ids.length}));
