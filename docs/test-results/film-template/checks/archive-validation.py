from pathlib import Path
import hashlib,json,shutil,datetime
root=Path('/home/chiharukiryu/cdev/viento-studio');dest=root/'docs/test-results/film-template';original=Path('/tmp/viento-film-template-browser-complete');wrapper=Path('/tmp/viento-film-template-native')
h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
receipt=json.loads(Path('/tmp/viento-film-template-validation-receipt.json').read_text())
assert not (dest/'browser').exists();assert not (dest/'checks').exists()
mediaBefore={str(p.relative_to(dest/'media')):h(p) for p in (dest/'media').rglob('*') if p.is_file()}
shutil.copytree(original,dest/'browser')
checks=dest/'checks';checks.mkdir()
logs={'targeted-tests.log':'/tmp/viento-film-template-targeted-final.log','rust-template-tests.log':str(wrapper/'test.log'),'native-build.log':str(wrapper/'build.log'),'mobile-prepare.log':'/tmp/viento-film-template-mobile-prepare.log','browser-run.log':'/tmp/viento-film-template-browser-complete.log'}
for name,src in logs.items():shutil.copyfile(src,checks/name)
for rel in ['Cargo.toml','Cargo.lock','src/bin/mobile-storage.rs','src/bin/workspace-archive.rs']:
 target=checks/'native-wrapper'/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(wrapper/rel,target)
for file in ['validation-receipt.py','archive-validation.py']:
 shutil.copyfile('/tmp/viento-film-template-'+file,checks/file)
shutil.copyfile('/tmp/viento-film-template-validation-receipt.json',checks/'verification.json')
shutil.copyfile('/tmp/viento-film-template-production.json',checks/'production-snapshot.json')
diag=checks/'driver-diagnostics';diag.mkdir()
for name in ['first','diagnostic','verified','final']:
 source=Path('/tmp/viento-film-template-browser-'+name)
 shutil.copyfile(source/'browser.json',diag/(name+'.json'))
 shutil.copyfile(str(source)+'.log',diag/(name+'.log'))
for rel,digest in receipt['browserEvidence']['sourceHashes'].items():assert h(root/rel)==digest,rel
(checks/'source-guards.json').write_text(json.dumps({'sourceStableDuringBrowser':True,'hashes':receipt['browserEvidence']['sourceHashes'],'formalChangedFileHashes':{rel:h(root/rel) for rel in ['scripts/tests/project-templates.test.mjs','scripts/tests/project-templates-smoke.mjs','scripts/tests/desktop-library.test.mjs','src-tauri/src/project_templates.rs']}},ensure_ascii=False,indent=2)+'\n')
(dest/'browser'/'README.md').write_text('''# 影视模板浏览器验收

真实 Chromium `Chrome/156.0.8078.73` 完整通过；8 张截图、17 份来源哈希稳定，运行异常 0。原始回执见 [browser.json](browser.json)，命令与日志见 [检查记录](../checks/README.md)。

桌面作品库验证 6 个模板的中文／英文选项、取消、游戏／文学／戏剧／影视的真实原生创建。移动日语编辑器在 390 px 中从空影视工程开始，创建剧本场次和分镜；重复对白、动作提示与时间码保持正文，分镜通过字段编辑将镜头号 S001 改为 S002，保存后两份文档以原身份重开。既有戏剧和软件模板的创建、保存、重开也全部通过。

浏览器 textarea 会将 CRLF 规范为 LF；回执按真实界面草稿逐字比对。BOM＋CRLF 原样落盘与 ZIP 往返由实际原生测试单独验证。移动端媒体接口保持既有禁用状态；图片、音视频及完整 ZIP 异地迁移由 [桌面媒体链路](../media/README.md) 验证。

系统目录选择器、窗口启动和 Tauri IPC 线缆由本地测试宿主替代；项目创建、正文读写、模板读取均调用未修改的生产 Rust 模块。不代表实装桌面窗口、Android 设备或游戏引擎运行。

| 截图 | 验证内容 |
| --- | --- |
| [desktop-template-zh.png](desktop-template-zh.png) | 桌面中文模板选项 |
| [desktop-template-en.png](desktop-template-en.png) | 桌面英文选项及影视说明 |
| [mobile-template-ja.png](mobile-template-ja.png) | 移动日语 6 项目录 |
| [drama-dialogue-ja.png](drama-dialogue-ja.png) | 旧戏剧重复对白保持正文 |
| [film-template-ja-390.png](film-template-ja-390.png) | 390 px 日语影视入口 |
| [film-screenplay-ja-390.png](film-screenplay-ja-390.png) | 场次、重复对白、时间码与动作提示 |
| [film-storyboard-fields-ja-390.png](film-storyboard-fields-ja-390.png) | 分镜字段实际修改 |
| [software-fields-ja.png](software-fields-ja.png) | 旧软件 YAML 字段编辑 |
''')
(checks/'README.md').write_text('''# 影视模板定向验证

本组 Node 测试 **33 / 33 通过，0 跳过／失败**；真实 Rust 模板测试 **5 / 5 通过，0 忽略**；完整 Chromium 工作流通过，8 张截图、17 份来源稳定。它们是本组实际结果，不代表本轮全量检查，也不与其他回归计数重复相加。

- [verification.json](verification.json)：实际命令、环境范围、二进制及来源 SHA-256、浏览器原始证据清单。
- [targeted-tests.log](targeted-tests.log)：模板目录、原生创建／BOM＋CRLF／归档恢复、桌面作品库、翻译覆盖和 HTTP 模板读取。
- [rust-template-tests.log](rust-template-tests.log)：生产 Rust 模板模块 5 项测试；41 项无关测试按名称过滤，未算通过。
- [native-build.log](native-build.log) 与 [native-wrapper](native-wrapper/Cargo.toml)：临时最小宿主编译记录、锁文件和完整 wrapper 来源。两份 wrapper 仅把既有 example 的模块引用指向真实生产 `workspace.rs`／`mobile_storage.rs`，不复制改写业务实现，不构建整套 Tauri。二进制哈希记录在 verification.json，避免把约 45 MB 二进制重复存入仓库。
- [mobile-prepare.log](mobile-prepare.log)：仅准备移动编辑器生成资源；桌面只同步共用翻译副本，没有重打桌面资源包或安装程序。
- [browser-run.log](browser-run.log)、[最终浏览器回执](../browser/browser.json)、[source-guards.json](source-guards.json)。
- [production-snapshot.json](production-snapshot.json)：旧 5 个模板与旧兼容包的 canonical 哈希逐包保全，新模板仅增加声明数据与翻译。

`driver-diagnostics/` 保留四轮测试驱动诊断的原始回执和日志。早期驱动只等按钮可用，可能早于工程目录返回便创建文档，误用旧默认模板；另会在 HTML 仍解析时导入顶层缓存 DOM 的模块，令测试自身过早初始化模块。现等待完整模板目录、正确工程 ID／名称与 DOM 解析完成；只对导航引起的两种明确 CDP 上下文销毁错误重试。未修改产品代码、未跳过旧戏剧／软件或新影视检查、未忽略任何业务响应和断言。这些失败轮次独立保留，**不计为通过，也不作为新增生产缺陷结论**。
''')
mediaAfter={str(p.relative_to(dest/'media')):h(p) for p in (dest/'media').rglob('*') if p.is_file()};assert mediaAfter==mediaBefore
for directory in [dest/'browser',checks]:
 files={str(p.relative_to(directory)):{'bytes':p.stat().st_size,'sha256':h(p)} for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='evidence-inventory.json'}
 (directory/'evidence-inventory.json').write_text(json.dumps({'files':files,'count':len(files),'bytes':sum(row['bytes'] for row in files.values())},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'browserFiles':len(list((dest/'browser').rglob('*'))),'checksFiles':len([p for p in checks.rglob('*') if p.is_file()]),'browserPNG':len(list((dest/'browser').glob('*.png'))),'mediaUnchanged':True},ensure_ascii=False))
