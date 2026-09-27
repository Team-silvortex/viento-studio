# ADR 0002：World 投影与属性权威来源

日期：2026-09-27。状态：采用于 V-M1。契约版本：实验性 semantic v1；软件仍为 0.0.2，作品格式仍为 v1 / v2 / v3。

## Project 与 World

旧作品是 Project。每个旧作品先产生一个 Document-backed World，只存在于查询结果和界面内存。World ID 为 `world:` 加 SHA-256，输入为规范 JSON 数组 `["viento-legacy-world", 1, projectId]`。它与 Project ID 不同，移动工程目录不改变它。现阶段没有创建第二个 World 或写入 `worlds/` 的操作。

已登记文档的 UUID 直接成为 Object ID，已登记素材 UUID 直接成为 Resource ID。没有登记的旧文档使用 `legacy-document:` 加 `[projectId, sourcePath]` 的规范 JSON 摘要；这只是只读查询身份，改名会改变身份，界面明确提示。读取不会自动登记或修改旧项目。

文档类型进入 `io.viento.document/<documentType>` 命名空间，仍沿用项目解析配置，不因为名称相似就赋予游戏、软件等领域语义。未知类型按通用 Document 展示并发出诊断；原始登记的未知字段保留在来源描述中。旧模板仍是文档模板，不执行代码。

## 字段的唯一权威来源

| 内容 | 权威来源 | 投影行为 |
| --- | --- | --- |
| 文档字段值 | 文档原文字节 | 共用字段解析器输出值及范围；没有独立可写属性表 |
| 叙事、未映射值、YAML 别名等 | 原文 | 保持原样；未映射或解析失败时给出诊断 |
| 对象显示名称 | 当前解析标题，或源文件名 | 仅作展示，不是独立可编辑设计属性 |
| 身份、归属、附件绑定 | 原有登记 | UUID、关系 kind / slot、素材引用不变 |
| 类型与解析配置 | 作品清单及既有默认规则 | 引用原规则；不猜测或安装工程插件 |
| 素材内容摘要 | 已登记的内容指纹 | 保留来源，不将它冒充本次内容验证 |
| 素材位置的可用性 | 本机只读观察 | 与设计 revision 分离；本机绝对路径不进入响应 |

`properties` 的 `field-N` 是当前源版本内的字段序号。每项都有 `propertyBindings`，包含原文逻辑路径、`sourceRevision` 和半开 UTF-16 范围 `[start, end)`；范围与现有 JavaScript 保真编辑器一致，包含 BOM 的字符偏移。字段值以字符串携带其 `kind`，大整数及十进制写法不经浮点数转换。重复字段标签不合并。

字段序号不能脱离源版本用于后续修改。V-M2 已实现的单属性命令重新读取来源并验证 revision，再调用现有保真编辑器；不能将当前投影直接写回文件，见 [ADR 0003](0003-single-property-command.md)。Model-backed 属性、属性权威切换和多记录事务尚未启用。

## revision、查询与限制

规范 JSON 对对象键按代码单元排序，数组保留语义顺序。Object revision 包含源路径、完整原文、原始字节 SHA-256、登记和实际解析配置。World revision 包含算法版本、清单、类型定义、按 ID 排序的 Object revision 和素材登记；不含时钟、绝对路径或素材可用性观察。

Node 适配器顺序读取，复查目录清单、登记及每份原文摘要；读期间检测到变更返回 `409 world_read_conflict`。这是一份经过复查的观察视图，**不是事务提交代次或可用于 Build 的一致性快照**。所有外部写入方尚未共享 World 事务，固定构建输入须等待 V-M3 / Snapshot 契约。

查询允许携带 `expectedRevision`，与当前投影不符时返回 `409 world_revision_conflict`。`world.inspect`、`object.list`、`object.inspect`、`world.validate` 由 GUI、CLI、HTTP 共用同一可移植查询函数；命令描述包含输入 / 输出 Schema、前置条件、空副作用和只读能力要求。`world.validate` 只检查当前投影可见的解析和引用诊断，不表示素材内容、构建或运行环境验证成功。

为控制内存，Node 读取每份原文最多 8 MiB、合计最多 64 MiB；超限明确返回 `413 world_source_limit`。素材只核对可访问性和登记大小，不将多 GiB 素材加载到内存或重新散列。符号链接边界、未知作品格式、不可读取登记会阻止投影，错误不泄露本机绑定路径。

## Schema 与宿主边界

[World](../../schemas/world-v1.schema.json)、[Object](../../schemas/object-v1.schema.json)、[CommandDescriptor](../../schemas/command-descriptor-v1.schema.json)、[ChangeSet](../../schemas/changeset-v1.schema.json) 和 [投影](../../schemas/world-projection-v1.schema.json) 均为实验性契约，与 workspace 格式版本独立。Schema ID 是稳定标识，应用和测试只使用仓库内定义，不访问该网址。ChangeSet 仅定义 `proposed` 提案形状，不定义通用执行或持久化能力；V-M2 的单属性执行回执与反向请求独立于提案。

当前提供 Node CLI 与桌面 / 浏览器编辑服务的世界视图。核心保持可移植，但 Android 尚无读取 World 的原生适配，能力发现不会显示该入口；纯静态浏览页同样不展示。旧文档保存、归档及移动能力保持原契约。
