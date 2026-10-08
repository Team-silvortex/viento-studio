// Add the scoped author-case workflow without rescoring earlier coordinates.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const read = file => fs.readFile(file, 'utf8').then(JSON.parse);
const data = await read('docs/function-atlas.json');
const baseline = await read('docs/test-results/runtime-case-documents/atlas-baseline.json');
const report = await read('docs/test-results/runtime-case-documents/results.json');
for (const [key, entries] of Object.entries(baseline.axes)) assert.deepEqual(data.axes[key], entries);
for (const key of ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities']) assert.deepEqual(data[key], baseline[key]);
const feature = 'runtime.case_documents';
data.axes.function.push({ id:feature,label:'工程验收用例保存、重用与稳定身份迁移',group:'场景与构建',
 entry:'工程验收用例→刷新/明确载入/保存/另存→资源包或完整迁移→同场景冻结运行；CLI兼容包装',
 boundary:['0.0.8之后未发布工作树，作者文档与原运行case分离，原场景/计划/控制/trace/native/WASM及adapter不变。',
 '严格四字段viento-runtime-case-document schema1，sceneObjectId唯一关联权威，case原DTO；256KiB UTF8/重复键/结构/稳定实例与定义登记边检查。',
 '普通文档UUID/类型登记与原子正文写，source SHA CAS及scene SHA/record在publish前再观察；拒force及互斥create/update，失败撤回本操作descriptor/临时正文，精确原文保持。',
 '新独立GUI文档控制器，显式fresh catalog/load/save/new，token仅authheaders，错误/冲突/late响应保留草稿和光标；pending save关闭标未确认，readonly关闭不标；三语窄屏。',
 '正文派生case→scene依赖、scene可选children；catalog/reader/import检查声明、instance/definition边和目标hash，只有已声明pinned requirement availability在reader延期，import完整复查。',
 '路径迁移保留全部UUID/BOM/CRLF/作者字节，无UUID clone/自动预期学习；完整archive保留损坏可修正文，selective package拒不完整用例。',
 '保存与引擎任务槽解耦，fresh作者读取不能用frozen缓存代替；已载入纯case可sourceoffline对同scene frozen运行，scene绑定不符在job/session前拒。',
 '准备桌面实际Node/双引擎与原生完整归档；移动仅可移植规则与准入desktop采样，不是Android执行/界面/安装验收。'],
 next:'分别定义用例分组、批量验收、作者行为和更丰富运行观察；不从稳定ID迁移推导UUID克隆或跨引擎任意脚本转换。',
 platforms:['Linux本机作者服务、工作台与可信Godot/Bevy CLI','纯模块可准备到移动资源；无Android引擎服务','未更新安装包或验收Tauri/设备'],delivery:'working-tree' });
const implementations=[
 ['i133','runtime-case-document.mjs：可移植工程包装与场景绑定',['engine/runtime-case-document.mjs']],
 ['i134','runtime-case-documents.mjs：fresh作者目录与原子保存守护',['scripts/lib/runtime-case-documents.mjs']],
 ['i135','app-runtime-case-documents.js：独立用例文档交互',['web/modules/app-runtime-case-documents.js','web/modules/app-doc-service.js']]
];
for(const [id,label,paths]of implementations)data.axes.implementation.push({id,label,kind:'product',language:['JavaScript'],paths});
const proofs=[
 ['e536','test','scripts/tests/runtime-case-document.test.mjs','纯包装严格数据/字节/重复键/场景绑定/依赖及联合预算。'],
 ['e537','test','scripts/tests/runtime-case-documents-host.test.mjs','原文保存、CAS、scene/doc publication races、新登记回滚、offline与frozen绑定/CLI。'],
 ['e538','test','scripts/tests/runtime-case-packages.test.mjs','13专项：源闭包、子内容、global/instance/多case、pinned要求、伪造包、v3→v2路径与原字节迁移。'],
 ['e539','test','scripts/tests/runtime-case-documents-ui.test.mjs','显式作者用例工作流、草稿/冲突/迟到回执、三语及认证请求。'],
 ['e540','test','scripts/tests/project-build-http.test.mjs','新增作者动作继承auth/JSON/local origin，author CAS与无tool保存不占job。'],
 ['e541','report','docs/test-results/runtime-case-documents/results.json','当前轮应用/浏览器/准备副本/真实双引擎/完整归档/历史与清理的限定事实。'],
 ['e542','report','docs/test-results/runtime-case-documents/browser/browser.json','Chrome实际register/load/取消draft替换/conflict/savecopy/6jobs/三语390px/offline/dirty作者。'],
 ['e543','report','docs/test-results/runtime-case-documents/packaged-resources.json','固定Node24.20.0实际save/load/native fullarchive+Godot/Bevy frozen offline pass/fail/CLI；mobile只pure数据。'],
 ['e544','report','docs/test-results/runtime-case-documents/source-hashes.json','本轮冻结产品与测试SHA，不包括文档报告/atlas以避免循环。'],
 ['e545','report','docs/test-results/runtime-case-documents/historical-preservation.json','1814历史/9frozen backend-WASM/19Rust原字节保持，前两未发布轮证据不改。'],
 ['e546','report','docs/test-results/runtime-case-documents/cleanup.json','仅本轮初始不存在7临时目录清理，既有工具/data/preferences/install保留。'],
 ['e547','report','docs/test-results/runtime-case-documents/native-helpers-proof.json','未变Rust fresh offline locked helpers用于应用/归档，不重跑旧Rust独立tests。']
];
for(const [id,kind,path,note]of proofs)data.evidence.push({id,kind,path,note});
const proofIds=proofs.map(p=>p[0]);
const bindings=[
 ['b229','semantic-js','i133','纯工程文档识别、case分离与场景/实例/定义依赖守护；不读文件或模拟运行。'],
 ['b230','node-service','i134','fresh作者catalog/load/save，双修订与publication再观察，既有事务复用。'],
 ['b231','persistence','i006','普通原子文档writer的可选发布守护；case新登记失败仅回滚本次descriptor。'],
 ['b232','ui','i135','独立用例文档controller、auth headers、显式载入和写入、迟到回执/草稿守护。'],
 ['b233','ui','i076','构建工作台传递scene/context和纯case，冻结运行与作者保存分别准入。'],
 ['b234','persistence','i040','选择包source-derived依赖与optional scenechildren、requirements/真实target核验及字节稳定迁移。'],
 ['b235','quality','i126','CLI兼容原case与保存包装，scene绑定守护与旧有限模式/文件边界。']
];
const score={implementation:[3,'工程文档保存/重用/迁移主链接入；批量suite、更多作者行为及规模边界待开发。'],verification:[3,'纯规则/事务/HTTP/UI/包、Chrome、prepared双引擎及nativearchive有本轮限定证明；安装/设备独立。'],decoupling:[4,'作者包装/身份/存储与纯运行case/完成评判/具体backend分离，复用原事务和运行协议。'],delivery:[2,'0.0.8之后未发布工作树和准备副本，未制作新版本/安装产物。']};
for(const [id,architecture,implementation,role]of bindings){data.bindings.push({id,architecture,function:feature,implementation,role,evidence:proofIds});for(const [maturity,[value,reason]]of Object.entries(score))data.cells.push({coordinates:[architecture,feature,implementation,maturity],value,reason});}
for(const [to,reason]of [['runtime.verification_cases','内层用例与评判契约保持，真实frozen运行仍由可信宿主确认。'],['authoring.document-edit','普通正文版本/原子创建保存机制复用，无force或第二份作者权威。'],['identity.registration-ownership','注册文档与scene/instance稳定身份支撑定位迁移。'],['resource.package','选择式source依赖闭包、pinned目标及冲突/发布守护复用。'],['build.snapshot_plan','绑定scene必须与owned frozen计划一致，不用当前源替代已冻结准入。']])data.dependencies.push({from:feature,to,relation:'requires',reason});
data.workflows.push({id:'runtime-case-documents',label:'验收草稿→明确保存/载入→稳定身份迁移→同场景冻结重跑',steps:['authoring.document-edit','identity.registration-ownership',feature,'resource.package','build.snapshot_plan','runtime.verification_cases'],boundary:'作者文档fresh字节与双修订保护；包/完整迁移保留UUID和正文；frozen场景绑定提前检查，离线仅已有loaded纯case，不做批量或安装/Android引擎。'});
data.meta.scope=`本轮作者用例app${report.application.tests}/${report.application.passed}、0fail/skip/cancel、${report.application.javascriptFiles}JS/API/0.0.8；Chrome${report.browser.scenarios}scenarios/3语390px/6jobs，prepared Node24.20.0两引擎6offline sessions+native完整archive，mobile仅pure。历史1814/frozen9/Rust19/产品测试SHA${report.preservation.productAndTestHashes}保持；7临时dirs清理${report.cleanup.freedAllocatedBytes}B，未变Rust独立tests/安装/设备/版本发布不宣称。新增runtime.case_documents及7bindings 3/3/4/2，不改旧坐标/历史评分。此前范围原样保留：`+baseline.meta.scope;
await fs.writeFile('docs/function-atlas.json',JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({architecture:data.axes.architecture.length,functions:data.axes.function.length,implementations:data.axes.implementation.length,bindings:data.bindings.length,cells:data.cells.length,evidence:data.evidence.length,dependencies:data.dependencies.length,workflows:data.workflows.length}));
