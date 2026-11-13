# 运行菜单：最终原生与离线验收

最终冻结实现的 **4项原生测试全部通过，零失败、跳过或取消**，原始TAP输出见 [test-run.log](test-run.log)。采用真实 Godot 4.7.2 viento-audiofix1、独立只读观察器和隔离 Xvfb／Mesa，XTest向真实窗口发送鼠标、Tab、Enter、方向键与P；不宣称物理设备或已安装应用验收。所有14份受检源文件在四项运行前后保持同一哈希。

- [受控端口](controlled-contracts.json)：旧访问、伪造端口和暂停中导航／重试／重启均拒绝，暂停、状态和累计账本保持；该项明确使用API探针，不冒充GUI操作。
- [原窗口](window-flow.json)：鼠标开始、实际移动收集、P暂停、Tab／Enter和鼠标分别恢复、实际收齐开门获胜、鼠标返回标题、键盘再次开始、实际危险区失败、键盘返回标题及鼠标退出。另独立验证暂停中GUI退出、Escape和真实窗口关闭。
- [标准工程ZIP离线交付](offline-delivery.json)：[menu.viento-build.zip](menu.viento-build.zip)经正式库存／迁移验证；令原作者与原生成目录不可访问后，恢复后的工程重跑同一完整键鼠路线。
- [同场景重开](scene-restart-flow.json)：**额外的一次性副本**只改变标题行为正文中的菜单配置，将首按钮设为restart；没有改写真实UI保存的104文件现场。鼠标按住1.2秒和Enter按住1.4秒均不提前跳转，释放后各恰好一次新访问；三次访问保持同一成员、创建全新场景和角色实例，初值覆盖生效，累计状态预算与总时间继续。

原窗口、离线和受控探针均使用真实Chrome作者工作流保存的104文件现场；第4项单独记录与该现场唯一差异 `documents/behaviors/start.json`。四项均核对各自作者前后完全一致，原UI104文件、旧暂停作者102文件和正式示例98文件保持。正式读事件器对完整运行流验收，无诊断，最终事件为finished。

裸Xvfb没有窗口管理器，首次在Godot启动后才创建标准关闭Atom会导致窗口登记协议0。最终驱动在启动Godot前以保持连接的X11客户端预注册标准 `WM_PROTOCOLS`／`WM_DELETE_WINDOW`，模拟普通窗口管理器初始化；关闭前还断言真实顶层窗口声明非零标准WM_DELETE，并发送该标准ClientMessage。没有修改产品或引擎，也没有把诊断用协议0投递计为通过。独立stock／custom、运行／暂停对照由本主题的环境证据另记。

PNG、ZIP和小型JSON／日志保留原字节；超过1MiB的重复采样JSON／日志使用确定性gzip保存。每份原始文件的路径、尺寸、SHA-256以及归档路径、尺寸、SHA-256均见 [evidence-inventory.json](evidence-inventory.json)，解压后逐字节核对一致。原始报告内临时绝对路径保留当时记录，不重写。此前调试和失败记录不混入本次最终通过目录。
