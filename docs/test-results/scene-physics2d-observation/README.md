# 二维物理步与移动碰撞观察验证

2026-10-25，基线 **0.2.3 / `eb1e08984fad04722c54f682c1ceba9b531f8fe0`**。本专题记录之后的开发工作树，尚未提交发布或更新本机安装。物理作者 schema 1／2、项目运行协议 4／7／10／11 保持；Godot 执行适配器及新增观察包装为 **0.23.0**。

## 本轮范围

新构建的物理项目在现有半秒 smoke 中输出独立 `VIENTO_PHYSICS2D` 协议1。中立读取器核对项目访问、角色/碰撞体身份、时钟、顺序与256样本预算，再由冻结计划补双方作者来源。Node 保存独立 `physics` 会话字段；工作台提供实例/访问/步骤筛选、请求与实际位移、接触位置/法线及双来源导航，不写作者数据或修改旧对象位置快照。

限定内建角色 stop／slide 移动的碰撞结果，非持续接触、传感器重叠、地板状态或所有脚本位移。普通交互窗口不发观察流；截断继续运行并显示部分记录，中断/错误保留最后样本为 incomplete。Bevy、Android、新安装和独立游戏发行不在本轮验收范围。

## 证据

| 检查 | 实际结果与范围 |
| --- | --- |
| [完整应用检查](full-check.log) | 8019项：7639通过、380条件跳过、0失败/取消；1327个JS语法及版本/API预检通过。app-only，不读取日常作品文档、模板与索引；之后新增Chrome runner已实际执行 |
| 纯契约与宿主 | 55/55通过、0跳过，其中新trace12与host4；终端执行结果见下方命令，此项未单独保存日志，也不冒称为文件证据 |
| [界面及邻接回归](ui-regression.log) | 100/100通过、0跳过，其中新组件14与build宿主8 |
| [真实Godot主矩阵](backend-final.log)、[机器结果](backend-final.json) | 10/10通过、0跳过；8个原生案例包括stop/slide、未知碰撞体、256上限、场景重入、零角色、异地交付和窗口截图 |
| [普通窗口旁路](backend-live.log)、[结果](backend-live.json) | 新增第11项1/1通过，真实交互运行不输出观察流 |
| [既有物理原生回归](legacy-native-final.log) | 16/16通过、0跳过；既有触发区、动画、响应及工程交付保持 |
| [后端邻接检查](backend-adjacent-confirmed.log) | 46项，45通过、1个历史原生工具条件跳过、0失败 |
| [真实Chrome流程](browser-1792919625779/browser.json) | 5条检查、60样本、7张截图、17源摘要；39个作者文件全程不变 |

各组包含交集，不相加成覆盖率。Rust作者规则未改，本轮不重跑或重标旧407项原生结果；完整应用检查仍准备同源WASM并运行适用的JS桥接测试。

工具为 **Godot 4.7.2.stable.official.ed1daf0bf**（摘要见后端报告）、**Chrome/154.0.8037.97**、Node.js 24。浏览器连接隔离本地HTTP服务，使用临时作者工程；没有安装Tauri、写本机偏好或迁移日常作品。

## 实际结果

- 新旧生成器真实运行后的位置相同，停止与沿墙滑动均只执行原有移动次数；记录请求与实际位移的差异。Godot的安全距离修正不被误报为新输入。
- 已声明碰撞体映射到冻结UUID和 `/bodies/N` 来源；脚本新建且复制metadata的碰撞节点仍为未映射。法线和位移均来自原生调用，JS不重算物理几何。
- 256条后只停止采样，半秒运行仍完成。场景离开/重入按visit分离，静态体/触发区场景得到有效零样本记录。缺帧、错身份、乱序和不完整末步不会伪装完整观察。
- 宿主验证独立保存、取消/超时/执行及最终回调异常后的样本保留与临时工程清理；旧任务的迟到输出不能修改后来的任务。旧inspect DTO不附加新字段。
- [桌面碰撞详情](browser-1792919625779/physics-observation-desktop.png)以及[中文](browser-1792919625779/physics-observation-zh-CN-390.png)、[英文](browser-1792919625779/physics-observation-en-390.png)、[日文](browser-1792919625779/physics-contact-ja-390.png)390px均无横向溢出。过滤、步骤、前后样本、焦点、双方来源定位和脏稿保留通过；轮询不改旧runtime或physics数据。
- [独立工程ZIP](observed-physics.zip)在原author/build目录改名后解包到新目录，重新import/script-check/run；30条观察与触发区→动画链均通过。它仍是需要Godot工具的生成工程。

碰撞点的坐标及原生返回值含义依据[Godot KinematicCollision2D](https://docs.godotengine.org/en/stable/classes/class_kinematiccollision2d.html)与[PhysicsBody2D](https://docs.godotengine.org/en/stable/classes/class_physicsbody2d.html)官方文档；具体接入结论以本专题实测为准。

## 复现入口

```sh
node --test scripts/tests/project-physics2d-trace.test.mjs scripts/tests/project-physics2d-host.test.mjs scripts/tests/project-runtime-query.test.mjs scripts/tests/project-runtime-events.test.mjs scripts/tests/scene-control-host.test.mjs scripts/tests/project-build-service.test.mjs
VIENTO_GODOT_BIN=/absolute/path/to/Godot node --test scripts/tests/scene-physics2d-observation-backends.test.mjs
VIENTO_GODOT_BIN=/absolute/path/to/Godot node scripts/tests/scene-physics2d-observation-smoke.mjs /absolute/path/to/google-chrome
npm run check -- --app-only
```

浏览器与后端报告使用独立新路径，不能覆盖已保存报告。窗口截图需要显示服务；条件不满足的测试必须按实际skip记录。

## 调试过程与保留

[首次后端日志](backend-attempt-1.log)和[结果](backend-attempt-1.json)保留初次失败：静态夹具缺少运动字段清零、运行时点读取到未完成的getter修复；之后主矩阵全部通过。[邻接首次日志](backend-adjacent-final.log)保留旧测试仍锁定0.22.0描述符/指纹的两项失败，更新当前适配器断言后通过。旧生成器/runtime另有固定SHA断言，不以更新期望取消旧兼容性要求。

Chrome启动前曾因测试清单文件名拼写错误退出，尚未启动浏览器或改作者工程；修正测试后通过，空输出目录已删除。[最终来源与保留摘要](preservation.json)核对历史test-results、模板、Rust和旧后端源码；[文档链接](links.json)及[图谱检查](atlas-check.log)单独记录。历史报告不重标。
