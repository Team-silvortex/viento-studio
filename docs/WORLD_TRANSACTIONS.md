# 可恢复的批量属性提交：V-M3 第一条纵切

本功能纳入软件版本 0.0.3，开发阶段验证记录保留执行时的 0.0.2 版本标识。`changeset.apply` 把多个已登记文档对象的属性修改作为一批保存，GUI、CLI 与 HTTP 共用规划器和执行器。原文仍是权威来源，作品清单继续使用 v2 / v3；这不是 workspace v4 或通用对象存储。

## 使用

在编辑模式打开 **世界与对象**，选择属性、输入新值并 **预览修改**，然后 **加入待提交修改**。切换到其他对象继续添加，最后 **预览批量修改 → 提交全部修改**。一个对象在一批中只能有一个属性，最多 32 个对象；移除或添加项目会使批量预览失效。有待提交队列时，单独应用按钮禁用，避免单项保存使队列基线失效。草稿和队列参与关闭确认，但尚未跨页面重启持久保存。

批量请求使用与单属性命令相同的入口：

```sh
node scripts/world.mjs --root /完整路径/作品库 --request batch.json
```

```json
{
  "command": "changeset.apply",
  "mode": "preview",
  "worldId": "<world.id>",
  "baseRevision": "<world.revision>",
  "actorRef": { "kind": "tool", "id": "local-cli" },
  "commands": [
    {
      "command": "property.set",
      "objectId": "<object.id>",
      "objectRevision": "<object.revision>",
      "sourceRevision": "<object.documentRefs[0].sourceRevision>",
      "propertyPath": "/properties/field-1",
      "value": "125"
    }
  ]
}
```

ID、字段路径和所有版本来自同一次查询。预览不创建作品文件；返回 `changes` 数组、预计 revision、`proposed` 提案和受版本约束的反向批量请求。将 `mode` 改为 `apply` 后重新校验整批。任一属性无效、版本过期、重复对象或超出大小限制，整批都不会开始发布。无变化的批次返回 `unchanged`，不替换源文件或更新提交记录。

`POST /api/world/commands` 接受同样的 JSON，预览、保存与恢复均沿用写鉴权、JSON 类型、1 MiB 请求上限和限流。`actorRef` 是调用者标签，不是认证身份。每个文件最多 8 MiB，整批前后镜像合计最多 32 MiB，世界读取仍限制为 64 MiB 正文。源内容必须可无损映射到已知字段；数字仍用字符串传输。

## 发布与恢复

执行器取得现有跨进程登记锁，在锁内重新读取世界和全部属性。它不在持登记锁期间取得文档队列，因此不会与旧编辑器的“文档队列 → 登记锁”顺序死锁。

| 阶段 | 磁盘状态 | 崩溃后恢复方向 |
| --- | --- | --- |
| 暂存 | 私有目录内的前后镜像和意图；原文未改 | 原文不变，暂存目录可留作垃圾 |
| 意图发布 | 暂存目录原子改名为 `active`，同步父目录 | 整批回退到修改前 |
| 数据发布 | 按顺序替换源文件并同步文件及目录 | 整批回退到修改前 |
| 提交标记发布 | `active/commit.json` 绑定意图摘要 | 整批保留／恢复到修改后 |
| 提交回执及结束 | 写 `head.json`，将 `active` 改名退役，再清理 | 完整新版本可读 |

日志保存在作品的 `.viento/world-transactions/`，与正文分开，不进入项目归档。`head.json` 只保留最后一次提交或回退回执；[回执 Schema](../schemas/transaction-receipt-v1.schema.json) 与 [提案 Schema](../schemas/changeset-v1.schema.json) 分离。它不是版本历史或持久幂等键。提交回执中的 revision 描述受控批次的预期设计状态，不替代读取后的实际版本检查。

恢复先验证意图、作品身份／清单摘要、登记路径、全部镜像摘要及全部当前源文件，再开始恢复。当前文件必须匹配对应的修改前或修改后摘要；其他内容视为外部冲突。损坏、截断、超限或包含路径链接的日志不会被当成可恢复数据。冲突时保留日志和文件，不强制覆盖。源临时文件使用日志可推导的唯一名称，恢复会清理中断留下的半成品，避免进入导出包。

编辑宿主启动时先尝试恢复，再登记／重建／开始服务。已经运行的界面遇到待恢复事务会显示 **恢复未完成的提交**。命令行也可检查或恢复：

```sh
node scripts/world.mjs --root /完整路径/作品库 --transaction-status
node scripts/world.mjs --root /完整路径/作品库 --recover
```

对应 HTTP 是 `GET /api/world/transaction` 和 `POST /api/world/commands`，后者请求为 `{"command":"world.recover","mode":"apply"}`。恢复入口没有 `force`。若日志损坏或存在外部修改，先完整保留工程和事务目录，再检查冲突；不要仅删除 `active` 来解锁，否则可能暴露部分提交。另一进程仍持锁时，先等其结束，不能抢占活跃写入方。

## 读取屏障与边界

`active` 存在时，世界查询、登记读取、旧文档读取／保存、原文 HTTP 和派生数据 HTTP、Node 导出、原生项目归档拒绝消费未完成状态。读取前后的 `head.json` 摘要检查还能检测期间完成的提交或回退，即使最终正文又恢复成旧值。已经生成的完整下载包仍可下载。只读浏览宿主不会自行恢复。

本阶段保证适用于遵守当前锁及读取屏障的应用版本。外部编辑器和旧二进制不遵守此协议，最后一次校验与文件替换之间仍有竞争窗口。测试覆盖 Linux 上真实进程的 SIGKILL；不宣称硬件断电认证、跨网络文件系统事务或 Windows／macOS 恢复验收。不支持目录同步的宿主会在修改正文之前拒绝提交。单属性 `property.set` 沿用原有单文件执行方式，受新读取屏障约束。

尚未实现语义创建、关系和资源绑定的多记录写入、一次修改同一对象多个属性、跨设备协作、永久撤销历史、Build 一致性快照或 Android 事务适配器。派生索引继续在保存后重建；重建失败不改变原文已经保存的事实。

## 验证

自动化测试包含 v2 / v3 两对象精确保存、整批校验、无写入预览、反向命令、无变化保存、GUI 队列和冲突保留、HTTP 鉴权及 CLI 恢复。真实子进程在意图发布、源临时文件写完、每次数据替换、提交标记和回执发布后被 SIGKILL；恢复过程中也再次中断，验证重启幂等及全旧／全新结果。坏日志、外部原文改动、路径逃逸和符号链接均验证不覆盖原文。

```sh
node --test --test-concurrency=2 scripts/tests/world-transactions.test.mjs scripts/tests/world-browser.test.mjs
```

本轮记录见 [V-M3 验证记录](test-results/world-m3/results.json)。历史 [V-M1](test-results/world-m1/results.json) / [V-M2](test-results/world-m2/results.json) 保留各自验收范围。
