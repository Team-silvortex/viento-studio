# Bevy 项目组装测试记录

## 隔离打包与项目管理界面

在隔离副本 `<ISOLATED_COPY>` 的项目副本上运行真实桌面 `desktop/prepare.mjs --resources-only` 和移动端 `mobile/prepare.mjs`，均通过。桌面资源包含 Bevy 组装、协议桥接和适配器模块；副本中逐文件 SHA-256 与源码一致，隔离资源内导入后端注册表与 Bevy 适配器、计算适配器指纹均通过。参见 `desktop-prepare-isolated.log`、`mobile-prepare-isolated.log` 和 `bundle-import-isolated.log`。

移动资源仅包含浏览器侧引擎模块；便携能力模块导入成功，Node 后端未打包，移动编辑器的项目构建入口保持关闭。此验证不代表 Android 实机运行 Bevy。未安装程序，也未修改用户配置。

项目管理界面的中文、英文、日文和后端范围回归 25 项全部通过，见 `backend-project-ui.log`。

- [Bevy 项目、交付与能力边界](native-delivery.log)：44 项全部通过、0 跳过；使用本机 Bevy 0.3.0，覆盖多场景检查、入口无头运行、异常生命周期、输入映射拒绝、离线 ZIP 和作者数据保留。未测试窗口、场景切换或实体键盘。

- [修复后双引擎最终回归](native-final.log)：83 项全部通过、0 跳过。首次全量检查发现一项旧能力断言过时和一项控制程序异步快照竞态；修复后包含真实 Godot/Bevy 回放、嵌套参数及非法参数竞态、项目生成交付和三语界面检查。

- 完整应用回归 `npm run check -- --app-only`：8,855 项中 8,255 项通过、600 项条件跳过，0 失败。首次全量发现的过时能力断言与回放异步快照竞态均已修复并复测。
