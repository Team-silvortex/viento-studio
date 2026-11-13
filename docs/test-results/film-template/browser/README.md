# 影视模板浏览器验收

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
