import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const file='docs/function-atlas.json', j=JSON.parse(await fs.readFile(file,'utf8'));
const old=JSON.parse(await fs.readFile('docs/test-results/backend-project-catalog/atlas-baseline.json','utf8'));
for(const key of ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities']) assert.deepEqual(j[key],old[key]);
for(const key of Object.keys(old.axes)) assert.deepEqual(j.axes[key],old.axes[key]);
const id='backend.project_catalog';
j.axes.function.push({id,label:'后端工程持久列表、冻结选择与旧执行链对接',group:'场景与构建',entry:'创建成功→原子宿主索引→重启历史列表→显式核验选择→原运行／控制／用例／验收组',boundary:[
'0.0.9发布后base9065667未发布工作树；只登记创建成功工程，恢复读入不生成删除ledger或隐式当前运行目标。',
'Node索引绑定backend／namespace、relative目录、source UUID／path、物理dev／ino与manifestSHA，strictdetached输入、256条／1MiB预算、跨进程锁／原子发布，不扫描陌生目录。',
'catalog恢复只列表，无作者正文、资源、工具探测／生成进程；显式选择完整inspect当前generator／adapter／bytes，重新绑定冻结control targets后复用原execute路径。',
'可读作品小清单的workspaceUUID另外核对，离线仍可检查与选取；新服务提供仅冻结场景，旧cachedscenes保留并通过全局sourceoffline诊断阻止author动作。',
'旧详情检查不会设置运行目标；选择epoch／job／latest／root／manifest／close前后守护；状态GET不重发select，lostresponse只GETreconcile。',
'显式Refresh强制核对索引与作者状态；prev记录变化或缺失撤销选择，currentwriteownership不因索引缺项而丢失；activejob保持已准入上下文直到结束。',
'恢复工程统一preserved，selection不获得自动回收权；currentpristine3回收更新索引／quarantine路径；unknown／manual／sessions继续保留。',
'Godot1图片／2实例／3 GDS与Bevy2真实重启后运行；两实例后端另接4步控制、三断言、两成员组／叶报告，作者与frozenbytes保持。',
'中英日390px、实际Chrome来源离线／lateclose／forcedrefresh与Bevy数据工程另证；prepared副本只证明sourcecopy与copyhost／pureVM，不提升Tauri安装或Androidhost成熟度。',
'CLI及本轮前未登记输出不自动入GUI，只有冷inspect；root／cache路径变化不自动迁移，索引本机状态不进作者包；无手动删除／回导／独立发行／native ns-nova。'],
next:'明确移除登记与删除产物的审阅边界、跨路径缓存迁移、可见保留预算；旧会话报告历史恢复单独接入。',platforms:['Linux本机服务Godot4.7.2／Bevy0.19.1及Chrome154三语390px','桌面prepared副本；Android仅已有pureDTO保持，无安装或设备验收'],delivery:'working-tree'});
for(const item of [
{id:'i159',label:'本机创建登记、原子索引与恢复身份guard',kind:'product',language:['JavaScript'],paths:['scripts/adapters/node-backend-project-catalog.mjs']},
{id:'i160',label:'服务重启历史、显式运行选择与冻结控制上下文',kind:'product',language:['JavaScript'],paths:['scripts/lib/project-build-service.mjs']},
{id:'i161',label:'三语历史来源、当前运行目标与强制刷新',kind:'product',language:['JavaScript','CSS'],paths:['web/modules/app-backend-project.js','web/modules/app-project-build.js','web/project-build.css','web/i18n/en.js','web/i18n/ja.js']}])j.axes.implementation.push(item);
const sources=[
['test','scripts/tests/backend-project-catalog.test.mjs'],['test','scripts/tests/backend-project-catalog-service.test.mjs'],['test','scripts/tests/backend-project-catalog-boundary.test.mjs'],['test','scripts/tests/backend-project-catalog-ui.test.mjs'],['test','scripts/tests/backend-project-catalog-build-ui.test.mjs'],['test','scripts/tests/backend-project-retention.test.mjs'],
['source','scripts/tests/backend-project-catalog-smoke.mjs'],['source','scripts/tests/backend-project-catalog-ui-smoke.mjs'],
['design','docs/BACKEND_PROJECTS.md'],['report','docs/test-results/backend-project-catalog/results.json'],
['report','docs/test-results/backend-project-catalog/full-check-frozen.log'],['report','docs/test-results/backend-project-catalog/full-check-initial.log'],
['report','docs/test-results/backend-project-catalog/catalog-focused-lock-repair.log'],['report','docs/test-results/backend-project-catalog/real-backends-final/results.json'],
['report','docs/test-results/backend-project-catalog/real-backends-initial/results.json'],['report','docs/test-results/backend-project-catalog/browser-confirmed/browser.json'],
['report','docs/test-results/backend-project-catalog/packaged-resources-frozen.json'],['report','docs/test-results/backend-project-catalog/service-review.json'],
['report','docs/test-results/backend-project-catalog/source-hashes.json'],['report','docs/test-results/backend-project-catalog/catalog-missing-temp-initial.json'],['report','docs/test-results/backend-project-catalog/catalog-missing-temp-final.json'],['report','docs/test-results/backend-project-catalog/catalog-core-lock-repair.log'],['report','docs/test-results/backend-project-catalog/cleanup.json'],['report','docs/test-results/backend-project-catalog/final-audit.json']];
const refs=[];let number=Math.max(...j.evidence.map(e=>Number(e.id.slice(1))));
for(const[kind,path]of sources){assert.ok((await fs.stat(path)).isFile(),path);const eid=`e${++number}`;refs.push(eid);j.evidence.push({id:eid,kind,path,note:'本轮持久工程对接限定证据；源码／真实工具／浏览器／准备副本／失败初轮分别记录，未提高旧平台评分。'});}
for(const [bid,architecture,implementation,role]of [
['b281','semantic-js','i155','复用严格纯清单DTO，不添加宿主IO至领域'],['b282','node-service','i159','持久索引与只读／运行恢复身份，清理权限分离'],
['b283','node-service','i160','恢复列表／冻结选择与原控制验收服务对接'],['b284','ui','i161','明确运行工程／来源与三语强制刷新']]){
j.bindings.push({id:bid,architecture,function:id,implementation,role,evidence:refs});
for(const [dimension,value,reason]of [
['implementation',3,'当前工作树完成明确范围内重启／选择／旧执行链；手动删除与迁移／回导另设计。'],
['verification',3,'固定Node全量、限定故障注入、实际双后端四类／Chrome三语及prepared证据；未宣称所有目标安装验收。'],
['decoupling',4,'纯manifest保持，Node索引／service权限／GUI与adapter分开；无新增backend格式／工具进程契约或Rust／WASM变动。'],
['delivery',2,'0.0.9后的未发布工作树及prepared副本，未提交发布版本或安装窗口／设备验收。']])j.cells.push({coordinates:[architecture,id,implementation,dimension],value,reason});}
for(const to of ['backend.project_management','build.workbench_lifecycle','execution.backend_middleware','runtime.control_replay','runtime.case_suites'])j.dependencies.push({from:id,to,relation:'requires',reason:'持久列表和明确选择复用原工程核对、冻结输入与可信执行上下文；不把恢复登记当成删除权限。'});
j.workflows.push({id:'backend-project-catalog',label:'成功生成工程→宿主持久登记→重启未选历史→显式选择核验→原运行／控制／验收／报告',steps:['build.snapshot_plan','execution.backend_middleware','backend.project_management',id,'runtime.control_replay','runtime.case_suites','runtime.case_reports'],boundary:'历史readonly/preserved，工具与作者离线不自动执行；实际生成／工具规则留adapter，currentwrite删除ledger永不从index复原，无陌生缓存认领或跨路径迁移。'});
j.priorities.push({label:'持久工程运行对接之后明确登记与删除审阅',functions:[id,'backend.project_management'],reason:'本机跨服务恢复与执行选择已接入；作者权威、恢复身份、清理凭据和旧会话历史应继续分离。',acceptance:'显式移除／删除的可审阅计划，跨路径迁移与容量预算，损坏／外部修改／会话报告保留验证。'});
j.meta.scope='0.0.9发布后base9065667新增backend.project_catalog，复用纯i155，新i159–161／b281–284及16cells 3/3/4/2。持久索引、明确冻结选择、旧控制／用例／验收链接入；当前工作树／Linux实际工具／Chrome／prepared另证。旧2588历史文件和全部旧atlas坐标评分前缀、sharedRust13／Godot7／scene23保持；本轮修改旧retention两处过期断言并加强root替换选择拒绝，初全量失败保留。无版本、commit、push或安装／设备交付。';
await fs.writeFile(file,JSON.stringify(j,null,2)+'\n');console.log(JSON.stringify({function:id,implementations:3,bindings:4,cells:16,evidence:refs.length,prefixes:'unchanged'}));
