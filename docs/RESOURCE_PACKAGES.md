# 选择式资源包 v1

0.0.5 新增，入口为编辑器 **导出 → 资源包**。采用“选择内容 → 包含依赖 → 预览导入 → 跨项目复用”的交互，参考 [Unity 的资源包导出流程](https://docs.unity3d.com/cn/current/Manual/AssetPackagesCreate.html)。包格式属于 Viento，扩展名为 `.viento-package.zip`；不改变 workspace v2 / v3，也不把资源复制进应用安装包。

## 包内数据

只需取出一个图片、视频、音频等文件时，可点击清单行右侧的 **导出原文件**，无需改变勾选；准备完成后保存原格式文件，返回清单时保留选择。插入素材窗口也提供相同入口。此操作仅保存素材本身，UUID 与依赖搬迁继续使用资源包，见 [单素材导出](EXPORT.md#单个素材导出原文件)。

| 项目 | 内容 |
| --- | --- |
| `manifest.json` | `format: viento-resource-package`、`version: 1`、来源项目标识、选中的根 UUID、依赖选项、对象／素材清单、所需类型、外部依赖、每个文件的大小及 SHA-256 |
| `documents/…` 或 `design-data/…` | 所选原始正文，字节不变 |
| `assets/…` | 按登记的逻辑路径组织实际素材，含外置资源，保留原格式 |
| `metadata/documents/<UUID>.json` | 对象登记、类型、关系、资源用途绑定和扩展字段 |
| `metadata/assets/<UUID>.json` | 素材登记、指纹、标签、逻辑路径及旧路径别名 |
| `templates/…` 或 `data-template/…` | 所用类型的模板；未落盘的内置模板按应用默认内容提供 |

不包含来源项目的 `workspace.json`、本机绝对路径配置、索引、缓存、会话或其他未选中的作品内容。结构定义在 [resource-package-v1.schema.json](../schemas/resource-package-v1.schema.json)，实际读取还检查路径、文件一一对应、UUID 唯一性、登记、关系、引用、类型规则和摘要。

`roots` 是用户明确勾选的身份；对象的所有登记关系、正文引用、资源绑定和模板引用形成依赖边。启用附属内容时还沿反向 `part-of` 收集子对象。遍历去重，不凭名称推测归属，不把代码块中的示例引用当作素材。关闭依赖收集时，未收集的直接依赖以 UUID、登记摘要和内容指纹记录，目标必须已有相同依赖。

## 导入规则

- 先把 ZIP 放入隔离缓存并流式解包，验证完整清单和 SHA-256，再检查目标；上传本身不改写作品。
- 注册身份与源文件一起搬迁；v2 / v3 根目录映射只替换登记中的路径字符串，保留未知字段、大整数及其余 JSON 字节。
- 相同文件复用，异内容、异身份、大小写／Unicode 等价路径及文件／目录冲突均拒绝。不会自动重命名、生成新 UUID 或替换既有正文。
- 新类型追加到目标清单，保留既有 JSON 字节和权限。既有类型必须兼容，不改变其他对象的解释规则；旧 v2 隐式类型工程若需要切换到显式类型规则，会报告冲突，需先整理项目类型。
- 外置素材写入目标自己的素材存储，来源机器的绑定不会被带入。目标的外置目录必须可访问；不静默回退到项目内。
- 预览固定目标 revision，提交持登记锁重新验证。未保存的编辑草稿会阻止入口操作；导入后的预览刷新失败与持久导入成功分别提示。

资源包来源和目标都要求已登记的 v2 / v3 项目。每个文件上限 8 GiB、总解包内容上限 64 GiB，上传的压缩文件上限 8 GiB；清单／单正文／单登记上限 16 MiB，单次所选正文合计上限 64 MiB。文件数量最多 200,000，还受 16 MiB 清单限制。大素材流式处理，清单只保留正文摘要，避免把整个项目的正文和视频同时驻留内存。

## 持久提交和恢复

`.viento/package-import/active/` 包含经过验证的意图和提交所需文件。它在写入、同步全部准备内容后原子发布；之后即使 HTTP 客户端断开，服务继续完成该事务。新增文件通过同目录临时文件和排他链接发布，已有相同文件再次复核；已有不同文件始终保留。目标清单只允许追加类型，保存前后镜像及原权限。

成功后写入 `head`、原子移走活动目录，再清理已完成记录。恢复重复执行不会创建另一套身份；若待写或已复用文件与预期不同，会保留活动记录，等待处理。Node World／文档服务／导出和 Rust 原生备份均检查活动记录，并以 `head` 变化检测跨读取发生的提交。它是宿主的资源导入事务，不是通用 World ChangeSet 或用户撤销日志。

预览默认空闲 15 分钟过期，最多持有 3 份，读取期间不释放正在使用的文件。完成、关闭和失败后清理，删除暂时失败会重试。后续操作清理 24 小时前的孤立预览／准备／完成目录，活动事务不会自动删除。相同文件系统使用硬链接连接校验缓存与事务准备文件，避免重复存一份大素材；跨盘发布使用流式复制。

## 接口与实现

| 接口 | 行为 |
| --- | --- |
| `GET /api/resource-packages` | 已登记对象、素材、依赖边、可用性和清单 revision |
| `POST /api/export`，`kind: resources` | 传 `ids`、`revision`、`includeDependencies`、`includeChildren`；继续使用既有下载、过期、释放及原生保存链路 |
| `POST /api/resource-packages`，`application/octet-stream` | 流式上传 ZIP 并返回导入预览、冲突及目标 revision |
| 同一接口，JSON `action: preview/import/release/recover` | 重新预览、明确提交、释放预览或恢复活动事务；导入需预览 ID 及 revision |
| `GET /api/resource-packages?status=1` | 查询是否存在未完成导入 |

POST 沿用现有写令牌和来源约束。只读浏览服务仅开放清单 GET 和导出；导入需要编辑服务。Android 尚未接入此选择式资源包界面和接口，原有完整迁移包继续工作。

纯依赖图选择位于 `engine/resource-package.mjs`；目录读取、包生成／检查、冲突计划、持久导入和 HTTP 生命周期分别位于 `scripts/lib/resource-package-*.mjs`。前端 `app-resource-packages.js` 复用 `app-export.js` 的保存、下载和草稿保护；中英日提示共用现有词典。

## 验证

`resource-packages.test.mjs` 覆盖实际 ZIP 往返、外置素材、去重、关闭依赖、模板解析、原始字节、大整数、v2/v3 映射、身份／路径／内容冲突、恶意 ZIP、HTTP 鉴权以及持久中断恢复。`resource-package-browser.test.mjs` 覆盖选择状态、三语、迟到响应、取消、冲突和导入确认。

`node scripts/tests/resource-package-smoke.mjs [Chrome 路径]` 使用隔离项目与独立浏览器配置完成实际下载、跨项目导入和编辑器重建。证据保存到 [browser.json](test-results/resource-packages/browser.json) 和同目录截图。它不会读取或修改日常作品。原生归档对未完成导入的阻断另由 Rust 单元测试验证，完整回归结果见 [验证指南](TESTING.md)。
