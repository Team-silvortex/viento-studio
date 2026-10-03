# 脚本与本地服务

[快速开始](../docs/GETTING_STARTED.md) · [架构与调用路径](../docs/ARCHITECTURE.md) · [验证指南](../docs/TESTING.md)

脚本负责桌面 / 浏览器的本机文件适配、转换与索引、HTTP 服务和作品维护。解析、布局与字段修改的共用实现位于 [engine/](../engine/README.md)，Android 使用独立原生存储桥，不启动这些 Node 服务。

## 启动

使用 Node.js 24，先执行 `npm ci`。网页入口需要已有作品，可先在桌面首页新建，再用本机配置或环境变量选择：

```sh
npm run workspace -- paths
VIENTO_WORKSPACE_ROOT=/完整路径/作品库 npm start -- --no-open
```

`npm start` 启动编辑服务，`npm run browse -- --no-open` 启动只读浏览；默认地址为 `http://127.0.0.1:4173/web/`，以启动日志为准。支持 `--port`、`--no-open`、`--no-build`、`--no-standardize`；后两项分别跳过索引构建和正文标准化，只有已有对应缓存时才使用。

Shell 入口 `scripts/start-doc-site.sh --mode edit|browse` 及旧的 `start-doc-site-edit.sh`、`start-doc-site-live.sh` 是兼容代理；实际编排在 `scripts/ops/site.mjs`。Node 命令适合跨平台开发。作品选择规则见 [本机数据目录](../docs/LOCAL_DATA_STORAGE.md)。

## 职责

| 入口 / 模块 | 职责 |
| --- | --- |
| `ops/site.mjs`、`lib/site-launcher.mjs` | 模式、参数、预检、重建和启动 |
| `ops/rebuild.mjs`、`lib/rebuild-workflow.mjs` | 标准化与索引任务编排 |
| `standardize-docs.mjs`、`build-static-doc-site.mjs` | 读取项目定义和源文，生成派生缓存及文档 / 素材 / 引用索引 |
| `desktop-server.mjs` | 桌面宿主启动的服务及原生桥交接 |
| `doc-site-server.mjs`、`browse-server.mjs` | 编辑和只读 HTTP 服务 |
| `adapters/node-document-storage.mjs` | 共用存储流程的实际文件适配 |
| `lib/doc-file-store.mjs`、`lib/doc-api-service.mjs` | 文件事务、版本快照、原子保存、登记和重建协调 |
| `lib/doc-server-routes.mjs`、`lib/doc-server-static-routes.mjs` | API 与静态资源路由 |
| `lib/project-service.mjs`、`lib/project-definition.mjs` | 项目类型、模板、预览和定义应用 |
| `lib/workspace.mjs`、`workspace.mjs` | 登记、校验、外置素材绑定与维护 CLI |
| `lib/export-package.mjs`、`lib/export-service.mjs` | 流式文档 / 完整项目包、任务及临时文件 |
| `lib/doc-api-metrics.mjs` | `/api/health`、`/api/metrics` 的诊断指标 |
| `project-build.mjs`、`adapters/node-project-build.mjs` | 冻结输入、构建计划、生成工程与独立运行会话 CLI |
| `backends/godot4.mjs`、`backends/godot4/runtime.gd` | Godot 4 的受限二维场景生成、真实进程诊断与运行协议 |
| `lib/project-build-service.mjs` | 编辑器构建任务的跨请求生命周期、进度、取消与宿主退出回收 |

启动前执行 `lib/verify-doc-api-contract.mjs`，核对共享契约、前后端入口和请求组装；失败时中止启动。完整数据流见 [架构说明](../docs/ARCHITECTURE.md)。

## 转换与作品维护

语义查询使用 `npm run world -- --root /完整路径/作品库`，可选择 `object.list`、`object.inspect` 或 `world.validate` 命令；不修改文件或登记。`adapters/node-world-projection.mjs` 负责只读盘点与来源复查，查询逻辑在可移植引擎内。GUI 和 `/api/world` 调用同一契约，详见 [世界与对象](../docs/WORLD_PROJECTION.md)。

语义命令使用 `node scripts/world.mjs --root /完整路径/作品库 --request command.json`（`-` 表示 stdin）。JSON 必须显式提供 `mode: preview|apply` 与所有版本条件；不能与查询参数混用。`property.set` 保存单个属性，`changeset.apply` 可恢复地保存多个现有对象的属性；`object.create` 创建新正文与登记，`relation.add` 追加引用或共享归属，两者均支持恢复。0.0.5 支持 `resource.bind`，按资源 UUID 和用途追加绑定，固定资源登记版本并支持恢复。开发源码另有 `projection.create`：从同一 OC 创建不同子模板配置，嵌入完整模板快照并登记来源与图片，见 [多份投影](../docs/OBJECT_PROJECTIONS.md)。`projection.update`：以已有 UUID 和修订条件修改投影标题／配置，同步新图片绑定；`scene.create`：使用已有类型，一次新增 Scene2D 正文与自动派生的角色／图片登记依赖，见 [场景创建](../docs/PROJECT_BUILD.md#创建场景)。`scene.update` 使用已有场景的身份和三层修订条件更新正文，保留继承／覆盖并追加缺少的依赖，见 [场景更新](../docs/PROJECT_BUILD.md#场景更新命令)。GUI 和 `POST /api/world/commands` 共用 `adapters/node-world-commands.mjs`；CLI 保存权威数据，不自动重建派生索引。`--transaction-status` 检查未完成事务，`--recover` 显式恢复；编辑宿主启动时也先恢复。协议和限制见 [批量提交](../docs/WORLD_TRANSACTIONS.md)、[对象创建](../docs/WORLD_OBJECT_CREATE.md)、[对象关系](../docs/WORLD_RELATIONS.md) 和 [资源绑定](../docs/WORLD_RESOURCES.md)。

```sh
npm run rebuild
npm run check
npm run workspace -- check-project --root /完整路径/作品库
```

前两条使用当前选择的作品：重建只更新 `.viento/cache/` 内的派生文件；完整检查还校验该作品的模板和索引。只开发程序时改用 `npm run check -- --app-only`，测试自己创建临时样例。

`workspace` 的写入命令应针对明确选择的作品使用：`register` 增量登记文件，`bind-assets` 更新本机素材绑定；`migrate-documents` 和 `apply-definition` 默认只预览，添加 `--write` 才应用。类型与模板契约及示例见 [项目工作流](../docs/PROJECT_WORKFLOW.md)。

通用转换按项目的解析规则处理 Markdown、文本、JSON、YAML，保留结构化数值、布尔、数组和对象；格式错误保留原文并报告，不猜测修复。旧作品兼容规则只有在相应类型需要时应用。源文、稳定 ID、登记和素材均是权威数据；索引中的解析结果不是需要另行维护的正文副本。

`standardize-docs.mjs --output <目录>` 只更新指定派生目录及其过期文档，要求与正文分离，并排除输出参与扫描。标准化记录使用完整逻辑源路径的摘要命名，支持不同扩展名的同名文档。

`reorder-source-metadata-fields.mjs` 是旧文本的专用维护工具：默认扫描，`--write` 才改写；只支持无后缀、`.md`、`.txt`，保留 BOM、换行和标题 / 代码围栏边界，不对 JSON / YAML 逐行排序。通用项目日常编辑不需要运行该工具。

## 测试与记录

实验性工程构建入口是 `npm run project:build -- --command plan|build|run`，与程序本身的 `desktop:build` 和文档索引 `rebuild` 分开。样例、显式引擎路径、默认本机缓存和取消／诊断见 [二维场景构建](../docs/PROJECT_BUILD.md)。开发源码的本机编辑器已通过 `/api/project-build` 接入工作台；任务服务仅接受场景／构建／任务 ID，工具路径由宿主配置，POST 沿用写入鉴权并额外限制本机同源访问。浏览服务器与 Android 不开放该能力。

`npm test` 执行回归，`npm run check -- --app-only` 另检查语法、版本和 API 契约。启用真实 Rust 归档与移动存储的方式，以及 Linux 原生 / Android 设备的区别，统一见 [验证指南](../docs/TESTING.md)。

编辑器测试覆盖草稿保护、模式往返、保存冲突、异步请求、重建失败及 BOM / CRLF / 空格保留；原生交互由独立流程验证，不能把轻量 DOM 测试当作真实系统窗口测试。b.4.5 阶段的 Linux 四组和 Android 模拟器证据见 [链路补测](../docs/WORKFLOW_VERIFICATION_b.4.5.md)；各轮验证从 [历史索引](../docs/history/README.md) 查阅，最新源码与安装范围见 [当前状态](../docs/STATUS.md)。
