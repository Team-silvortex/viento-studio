import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url)),dir=fileURLToPath(new URL('./',import.meta.url));
const data=JSON.parse(await fs.readFile(path.join(root,'docs/function-atlas.json'))),baseline=JSON.parse(await fs.readFile(path.join(dir,'atlas-baseline.json'))),r=JSON.parse(await fs.readFile(path.join(dir,'results.json')));
for(const key of ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities'])assert.deepEqual(data[key],baseline[key]);
for(const key of Object.keys(baseline.axes))assert.deepEqual(data.axes[key],baseline.axes[key]);
const feature='runtime.case_reports';
data.axes.function.push({id:feature,label:'当前批次成员详情与独立报告导出',group:'场景与构建',entry:'已完成suite成员→当前owned job/member只读回读→预期/实际详情→显式JSON下载',boundary:[
'0.0.8之后未发布工作树；report输出格式独立，不改作者case/suite/scene、plan/control/trace、adapter/native/WASM。',
'严格八字段viento-runtime-case-report schema1，十字段捕获上下文、实例目标、终态、原用例/采样与完整重新评价；UTF8 compact+newline≤2MiB，原64step/128actor/1024actor-step/128check预算。',
'纯validator只证明结构/评价一致，录入context为provenance，不能认证任意外部JSON的引擎执行或原作者字节；不合成事件/采样交错回放。',
'可信宿主固定member-UUID文件，wx0600临时+exclusive原子发布，读取拒绝符号链接/文件替换并核对rawSHA/context/definitionSHA；私有pin/路径不进入HTTP。',
'调度器保存committed叶结果后再发布reportAvailable；保存失败停止余项但保留真实execution/assertions/samples，末成员完整汇总不掩盖报告IO错误。',
'只允许当前service当前suite job/member UUID回读，不占执行slot、不读作者/工具/build；源离线/build被清理可读，新job/close/迟到owner拒绝，旧cache不扫描接管。',
'独立三语GUI核验context及public叶counts/state；可查看前面failed/partial报告，explicit Blob下载，不写草稿/自动预期，不导入外部report。',
'本轮实际Chrome/pinnedNode双引擎与mobile pure范围见results；无新installer/已安装Tauri/Androidhost或device。'],next:'单独设计跨重启报告历史、缓存管理和批次报告包；更广状态预期与引擎行为能力沿原边界演进。',platforms:['Linux本机workbench/Node可信Godot与Bevy','纯报告入口可准备到移动资源；没有Android报告宿主或引擎验收','未发布版本或安装产物'],delivery:'working-tree'});
const impls=[['i140','runtime-case-report.mjs：严格便携报告与完整重新评价',['engine/runtime-case-report.mjs']],
['i141','runtime-case-reports / project-build-service：可信文件pin和当前成员只读归属',['scripts/lib/runtime-case-reports.mjs','scripts/lib/project-build-service.mjs']],
['i142','app-runtime-case-report.js：独立三语详情与显式JSON导出',['web/modules/app-runtime-case-report.js']]];
for(const[id,label,paths]of impls)data.axes.implementation.push({id,label,kind:'product',language:['JavaScript'],paths});
const evidence=[
['source','engine/runtime-case-report.mjs','纯case/trace重新评价，严格上下文/终态/预算，深度冻结；无CST/YAML/IO'],
['source','scripts/lib/runtime-case-reports.mjs','privatepin/固定成员文件，exclusive原子发布与稳定bounded读取'],
['source','scripts/adapters/node-runtime-case-suite.mjs','保留committed叶结果与样本，独立报告保存失败停止余项'],
['source','scripts/lib/project-build-service.mjs','当前job/member-only读取，slot独立且读后复查owner/close，privatepins不返回'],
['source','web/modules/app-runtime-case-report.js','三语readonly详情，context/publiccounts准入与explicitBlobexport'],
['test','scripts/tests/runtime-case-report.test.mjs','12纯报告/评价造假/身份/terminal/预算/Unicode/VM回归'],
['test','scripts/tests/runtime-case-reports-host.test.mjs','18真实文件/pin/符号链接/稳定读取/无覆盖/ownedcleanup回归'],
['test','scripts/tests/runtime-case-report-service.test.mjs','13failed成员独立/active读/cancelprefix/IO不改assertion/offline/owner/close回归'],
['test','scripts/tests/runtime-case-report-ui.test.mjs','11三语/explicitdownload/脏稿/迟到context/publiccounts/认证hook/模块图回归'],
['test','scripts/tests/project-build-http.test.mjs','新增真实Godot成员报告与认证/篡改/offline/过期job；全HTTP重跑'],
['design','docs/RUNTIME_CASE_REPORTS.md','成员详情、报告/缓存/权限/终态与纯验证边界'],
['report','docs/test-results/runtime-case-reports/results.json','本轮app/Chrome/prepared与保存/清理范围'],
['report','docs/test-results/runtime-case-reports/browser/browser.json','真实Chrome详情与显式下载、3语390px、作者/草稿保留'],
['report','docs/test-results/runtime-case-reports/packaged-resources.json','pinnedNode准备副本与2真实后端报告；mobile只pure'],
['report','docs/test-results/runtime-case-reports/source-hashes.json','本轮最终产品测试sourceSHA（排除循环报告/atlas）'],
['report','docs/test-results/runtime-case-reports/historical-preservation.json','1945历史/9冻结/19Rust原字节保持'],
['report','docs/test-results/runtime-case-reports/cleanup.json','只清理7本轮初始不存在生成目录'],
['report','docs/test-results/runtime-case-reports/native-helpers-proof.json','fresh offline locked helpers用于全量，无独立Rust测试重跑'],
['report','docs/test-results/runtime-case-reports/review.json','纯/可信文件/调度/服务/UI边界只读复核']];
const ids=[];for(const[kind,p,note]of evidence){const id='e'+String(data.evidence.length+1).padStart(3,'0');data.evidence.push({id,kind,path:p,note});ids.push(id);}
const bindings=[['semantic-js','i140','纯报告契约、完整重新评价和数据预算'],['node-service','i141','可信报告文件pin/稳定回读与当前任务归属'],['node-service','i138','终态成员保存报告、保留断言及IO失败停止余项'],['ui','i142','实例步骤预期/实际/容差及显式独立JSON下载'],['ui','i076','父工作台接详情callback，保持编辑稿/引擎任务独立']];
for(const[architecture,implementation,role]of bindings){const id='b'+String(data.bindings.length+2).padStart(3,'0');data.bindings.push({id,architecture,function:feature,implementation,role,evidence:ids});
 for(const[maturity,value,reason]of [['implementation',3,'当前批次成员只读详情/导出接通；跨重启历史/缓存管理待定义。'],['verification',3,'纯/文件/服务/UI/HTTP与Chrome/pinnedNode双引擎有本轮证据；安装与设备独立。'],['decoupling',4,'重新评价规则、可信文件/归属与GUI下载分别实现，不新增引擎协议。'],['delivery',2,'未发布0.0.8工作树和准备副本，未交付新安装或设备。']])data.cells.push({coordinates:[architecture,feature,implementation,maturity],value,reason});}
for(const[to,reason]of [['runtime.case_suites','报告依附当前有序组的已完成成员，未运行成员不生成。'],['runtime.verification_cases','复用原case/trace与重新评价，不复制引擎检查规则。'],['execution.backend_middleware','报告来自已有可信执行终态/采样；Godot与Bevy共用格式。']])data.dependencies.push({from:feature,to,relation:'requires',reason});
data.workflows.push({id:'runtime-case-reports',label:'当前有序组→committed成员→私有pin回读→逐步详情→显式JSON下载',steps:['runtime.case_suites','runtime.verification_cases',feature],boundary:'作者来源离线可读owned报告；新job/close使旧owner失效，不扫描历史，不自动改预期，mobile仅pure。'});
data.meta.scope=`本轮成员报告app${r.application.passed}/${r.application.tests}、0fail/skip/cancel、${r.application.javascriptFiles}JS；新增${r.newRegressionTests.total}包含全量，Chrome/prepared2引擎与mobilepure实际范围见新results。1945历史/9冻结/19Rust/${r.preservation.productAndTestHashes}产品测试SHA保持，仅清理7本轮新增目录。新增runtime.case_reports5binding为3/3/4/2，旧图前缀保持；无新版本/提交/安装/Android执行。此前范围原样保留：`+data.meta.scope;
await fs.writeFile(path.join(root,'docs/function-atlas.json'),JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({ok:true,newFunction:feature,newBindings:bindings.length,newEvidence:ids.length}));
