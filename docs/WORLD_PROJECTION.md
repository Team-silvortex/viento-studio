# 世界与对象：V-M1 / V-M2 第一条纵切

已有作品可按对象查询、查看属性来源，并通过统一的 `property.set` 命令预览和保存单个属性。当前使用实验性 semantic v1 契约，纳入软件版本 0.0.3；早期验证记录保留执行时的 0.0.2 版本标识。

## 使用

通过桌面开发宿主或 `npm start -- --no-open` 打开作品，点击顶部的 **世界与对象**。视图提供对象搜索、属性、原文位置、归属关系、素材绑定及诊断；仅显示已保存内容。编辑模式下，对已登记对象选择 **修改属性 → 预览修改 → 应用修改**。保存后更新文档预览和世界视图。原文仍是唯一字段来源；外部修改后可刷新取得新投影。中、英、日文和窄屏布局均复用现有语言选择。

有未保存文档草稿或正在新建时不能修改属性。发生版本冲突会保留属性草稿；复制需要保留的输入后刷新，再重新选择字段和预览。新值会改变文档结构时，改用原文编辑器。

命令行要求明确指定作品目录：

```sh
npm run world -- --root /完整路径/作品库
npm run world -- --root /完整路径/作品库 --command object.list --search 旅人
npm run world -- --root /完整路径/作品库 --command object.inspect --object <文档UUID>
npm run world -- --root /完整路径/作品库 --command world.validate
```

直接使用 `node scripts/world.mjs` 时 stdout 为 JSON，错误 JSON 写入 stderr 并返回非零退出状态。加上 `--revision sha256:…` 可要求当前投影仍匹配之前读取的版本；不匹配返回 `world_revision_conflict`。

本机编辑服务公开 `GET /api/world`，通过 `command`、`objectId`、`search`、`typeRef`、`expectedRevision` 查询参数使用同一查询。默认 `world.inspect` 返回 World、对象、类型、关系、资源、诊断及命令目录。此查询路径拒绝写入方法和未声明参数。`/api/capabilities` 的 `semanticProjection` 声明查询能力，`semanticCommands` 声明可执行动作；Android 和静态浏览页目前没有这些能力。

## 属性命令

新入口是 `POST /api/world/commands`。请求形状如下，所有 ID、revision 和属性路径都从同一次 `world.inspect` 中取值；`value` 保持字符串，以免丢失大整数精度：

```json
{
  "command": "property.set",
  "mode": "preview",
  "worldId": "<world.id>",
  "baseRevision": "<world.revision>",
  "objectId": "<object.id>",
  "objectRevision": "<object.revision>",
  "sourceRevision": "<object.documentRefs[0].sourceRevision>",
  "propertyPath": "/properties/field-1",
  "value": "125",
  "actorRef": { "kind": "tool", "id": "local-cli" }
}
```

将实际请求存为 `command.json`，执行：

```sh
node scripts/world.mjs --root /完整路径/作品库 --request command.json
node scripts/world.mjs --root /完整路径/作品库 --request - < command.json
```

预览不写文件，返回 `change.beforeText / afterText`、预计的新 `revision` 和提案。确认后把同一请求的 `mode` 改为 `apply` 再提交；执行器重新校验全部版本。返回 `applied` 表示一个源文件已替换，`unchanged` 表示无需写入。`inverseCommand` 是可选的反向请求，需要新一轮版本校验，不能绕过之后的编辑。CLI 不自动更新派生索引，需用原有 rebuild 命令或界面刷新预览；GUI 保存后会更新索引。

HTTP 的预览和应用都沿用文档写 API 的鉴权、JSON 请求限制和限流。缺少版本、额外参数、未知类型及不安全的字段变化会拒绝，不提供强制覆盖。`world_revision_conflict` / `world_read_conflict` 表示版本变化；`world_write_busy` 表示其他进程持锁。

## 已交付范围

- World / Object / ChangeSet / CommandDescriptor Schema，以及 [属性权威来源 ADR](adr/0002-world-projection-and-property-authority.md)。
- v1 / v2 / v3 旧工程的可重复只读投影，已登记 UUID、共享归属和素材引用保留。
- 字段范围与原文版本绑定，大整数保持原精度，未知类型和未解析内容给出诊断。
- 核心不依赖 Node、DOM、HTTP、Tauri 或本机路径；摘要能力由宿主注入。
- GUI、CLI、HTTP 共用查询与 revision 检查。三种冻结样例验证没有创建或改写作品文件。
- `property.set` 共用可移植规划器与 Node 执行器；v2 / v3 登记对象单文件保真写入、无变化保存、冲突和反向命令已验证，见 [单属性命令 ADR](adr/0003-single-property-command.md)。

V-M2 单属性命令保持上述边界；后续 [V-M3 第一条纵切](WORLD_TRANSACTIONS.md) 已接入 `changeset.apply`、GUI 暂存队列和现有文档的多源恢复协议。0.0.3 之后源码还加入 [object.create](WORLD_OBJECT_CREATE.md)，以可恢复事务创建正文与登记，以及 [relation.add](WORLD_RELATIONS.md)，保真追加引用或共享归属并校验关系图。ChangeSet 仍是 `proposed` 提案，持久事务回执与提案分离。尚未接通 `resource.bind` 或通用混合 ChangeSet 执行器。应用锁能协调现有 Node 写入方，外部程序在最后校验与替换之间的竞争仍不属于保证范围。当前投影不是 Build 快照，不改变旧项目格式。

## 验证

```sh
node --test --test-concurrency=2 scripts/tests/world-projection.test.mjs scripts/tests/world-commands.test.mjs scripts/tests/world-browser.test.mjs scripts/tests/desktop-close.test.mjs
npm run check -- --app-only
```

新测试实际读取三种前身格式的隔离目录，对比查询前后的全部文件摘要，并用 JSON Schema 校验结果；跨层测试核对 HTTP / CLI 返回一致、同尺寸外部编辑后的 revision 冲突、未知类型、损坏源文、缺失素材、路径边界及读取上限。浏览器全局隔离测试执行同一投影核心。Schema 验证依赖 Ajv，仅作为开发依赖。

实际验收范围和结果见 [V-M1 记录](test-results/world-m1/results.json) 与 [V-M2 记录](test-results/world-m2/results.json)。V-M1 证据与指纹保留原样；0.0.1 的原生安装和完整作品恢复证据同样保留历史版本，不能当作本次界面或下一代写入模型的验收。
