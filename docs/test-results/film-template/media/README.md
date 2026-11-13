# 影视模板：真实媒体与标准迁移工作流

最终[原生工作流测试](test-run.log) **1项通过，零失败／跳过**。[原始回执](workflow.json)保留实际工具命令、HTTP请求、18份受检来源的前后SHA、作者文件／模板／素材哈希、项目和文档UUID。它调用按本轮正式模块新编译的Rust控制台包装器，使用未改的 `workspace.rs` 创建、导出、校验和异地导入；HTTP服务使用正式生产实现。不是已安装应用或Android媒体验收。

1. 实际创建空 `org.viento.oc-film` 工程，核对8种类型、8份模板，以及outline／scene使用prose、其他类型使用structured；起始没有文档或资源登记。
2. 普通HTTP保存带BOM／CRLF的prose剧本场次和structured JSON分镜。上传真实PNG、WAV、MP4，再次上传同字节素材复用原UUID。PNG和MP4本地生成，三个输入均经ffmpeg实际解码校验；Studio链路仅测试上传、引用、索引与字节交付，不宣称播放器、剪辑时间线或视频渲染。
3. 场次使用稳定 `asset:` UUID引用三类资源；分镜通过正式插入接口先生成草稿，再普通保存。草稿准备不写文件，已有零值、false、BOM和换行保持。普通重开、索引里的文档UUID／三资源引用及HTTP原资源读取均通过。
4. 通过正式Rust实现导出 [film-media.viento.zip](film-media.viento.zip)、校验、异地导入。先结束旧HTTP服务并移动原工程，确认旧路径不可访问，再从恢复工程重建索引、重开原文和读取三份资源。20份作者文件、8份模板及全部正文／元数据／素材SHA与保存后的导出基线一致；项目、文档和素材UUID保持，ZIP字节也未变。

新Rust工程第一次交给既有Node索引器时，`registerWorkspace`会规范化清单中布局对象的键顺序；测试明确记录前后SHA，并核对全部JSON值、项目UUID和模板出处语义相等。严格迁移字节基线是在该普通索引／作者保存步骤之后确定；没有把初始格式化变化冒称为从未写过清单，也没有修改生产代码来适配测试。

此前两次NEW测试夹具问题原样保留：首次[HTTP资源摘要／持久资源登记形状误比](diagnostics/first-fixture-shape.json)及[日志](diagnostics/first-fixture-shape.log)；第二次[额外初始清单原始字节断言](diagnostics/initial-manifest-key-order.json)及[日志](diagnostics/initial-manifest-key-order.log)。后者的20份ZIP迁移字节断言已通过，仅与尚未索引的初始清单键序不同。二者不是最终通过证据，不据此宣称生产媒体缺陷。

[author-final](author-final/workspace.json)仅供浏览原始文件；部分素材、素材登记和兼容清单受Git忽略规则影响。完整迁移应使用标准ZIP，它含全部20份作者数据及包清单，已由真实Rust导入逐字节验证。归档全部原始字节和逐文件SHA见 [evidence-inventory.json](evidence-inventory.json)。没有修改旧作品、旧菜单证据或正式生产来源。
