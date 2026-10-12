from pathlib import Path
import datetime,hashlib,json,re
S=Path('/tmp/viento-scene3d-removal-71u64wrk/project'); O=S/'docs/test-results/scene3d-removal-authoring'
read=lambda n:json.loads((O/n).read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
log=(O/'application-layout.log').read_text()
for text in ['tests 3811','pass 3811','fail 0','cancelled 0','skipped 0','todo 0','644 个 JavaScript 文件']:
 assert text in log,text
final=read('source-hashes-final.json');old=read('source-hashes-before-layout.json')
assert len(final)==777
assert [k for k,v in final.items() if old[k]!=v]==['scripts/tests/scene3d-removal-smoke.mjs','web/editor-layout.css']
for p,h in final.items(): assert sha(S/p)==h,p
core=read('core-results.json');assert core['status']=='passed' and core['nativeRust']['pass']==307
for n in ['independent-review.json','web-review.json','prepared-binding-layout.json','packaged-resources-layout.json']:
 assert read(n)['ok'],n
browsers={n:{'steps':len(read(n+'/browser.json')['steps']),'screenshots':len(read(n+'/browser.json')['screenshots']),'reportSha256':sha(O/n/'browser.json'),'sourcePhase':'final' if n.endswith('layout') else 'before-layout'} for n in ['browser-removal-layout','browser-copy','browser-objects','browser-preview']}
for n in browsers:assert read(n+'/browser.json')['ok']
result={'ok':True,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'feature':'Independent atomic 3D batch removal','version':'0.0.10','sourceManifestSha256':sha(O/'source-hashes-final.json'),'sourceFiles':777,'application':{'pass':3811,'fail':0,'skipped':0,'cancelled':0,'todo':0,'syntaxFiles':644,'apiAndVersion':True,'log':'application-layout.log'},'native':{'pass':307,'fail':0,'newUnits':17,'fmt':True,'clippyWarningsDenied':True,'wasmBytes':599948,'wasmSha256':sha(S/'engine/studio-core.wasm')},'focused':{'bridge':14,'proposal':10,'oldCoreAndProposal':245,'ui':24,'sourceHost':6,'modules':49,'independentGroups':16},'countsOverlap':True,'prepared':read('prepared-binding-layout.json'),'browsers':browsers,'finalToolbarLayouts':9,'independentVisualReview':'web-review.json','visualImagesPersonallyReviewed':6,'initialAttemptsPreserved':['core-fmt-initial.log','ui-tests-initial.log','independent-review-environment-initial.log','prepared-check-initial.log','application-initial-skipped.log','application-checks.log','browser-removal/browser.json','source-hashes-before-layout.json'],'repairedProductFinding':'Shared editor header non-wrapping overflow detected by visual review; fixed with wrapping tool layout. Final browser covers 1440/1024/390 in three languages.','phaseExplanation':'Core semantics and old browser controllers remain byte-identical across the layout fix. Final complete application, prepared-resource inventory/378 cases and removal browser repeated against the final manifest. Initial skipped parity case was an incorrect test CLI path, subsequently corrected and covered.','preservationExpected':{'historicalFiles':5242,'authorFiles':41,'externalTools':4},'scope':'Checks ran in isolated checkout; actual application and source identity verified separately. Standard VM and Chrome SwiftShader only, no installed desktop/Android/hardware GPU acceptance. No version bump, commit, push or installation.'}
(O/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
p=S/'docs/STATUS.md';s=p.read_text();needle='上一复制专题在 0.0.10 之后'
assert needle in s
text='''本轮[批量移除验收](test-results/scene3d-removal-authoring/results.json)在隔离副本通过：最终完整应用 **3811／3811**、**644** 文件语法／API／版本检查及 Rust **307** 项；专项与完整检查存在重叠。原生语义、原文保真、私有提案、会话归属、普通保存冲突与旧能力兼容分别验证，桌面／移动准备副本 **378** 组通过。版本仍为 **0.0.10**，实际源码写回另有字节核对记录。

实测覆盖批量移除、旧复制／对象管理／预览共 **32** 类流程；最终新增入口另测 **1440／1024／390px × 中英日** 九组工具栏布局，六张最终截图已目视。截图复查发现工具栏按钮增加后整页溢出，已修为随窗口换行，并重新跑过完整应用与准备副本检查。初轮日志、环境路径修正与修复前截图均保留；初轮缺少正确 CLI 路径而跳过的一项已在最终运行覆盖。功能图谱增至 **95** 功能／**236** 实现／**370** 绑定／**1480** 评分单元。浏览器使用 SwiftShader 软件渲染，准备副本用标准 VM，均不代表已安装版、Android 设备或硬件 GPU 验收。

'''
s=s.replace(needle,text+needle,1).replace('核对日期：**2026-10-11**','核对日期：**2026-10-12**',1);p.write_text(s)
print(json.dumps({'ok':True,'application':3811,'native':307,'prepared':378,'browserFlows':32}))
