# 可恢复的对象创建

0.0.4 纳入 `object.create`，补齐 V-M2 / V-M3 的创建链路。GUI、CLI 和 HTTP 使用同一可移植规划器及 Node 事务执行器；新对象继续保存为 workspace v2 / v3 的正文与文档登记，不更改作品格式。开发阶段的 0.0.3 验证记录保留原样，首次纳入版本的验收见 [0.0.4 记录](RELEASE_0.0.4.md)，当前平台状态见 [STATUS](STATUS.md)。

## 使用

在编辑模式打开 **世界与对象 → 创建对象**，选择工程已有类型，填写正文路径和原文，再 **预览新对象 → 保存新对象**。预览展示名称、身份、路径、将保存的原文及可映射属性。原文可以是 Markdown、TXT、JSON、YAML 或无后缀文本；格式由文件后缀决定。新表单从空白原文开始，类型的解析规则参与预览；不会自动加载项目模板。

身份在打开创建表单时生成，预览和保存沿用同一 UUID。更改类型、路径或正文会使预览失效。保存完成后选中新对象并刷新文档索引；索引重建失败仍显示已保存。已有文档草稿或待提交属性队列时，创建入口禁用。关闭、刷新和切换对象保护未保存创建草稿；草稿只在当前页面内存中保留。

命令行使用 `node scripts/world.mjs --root /完整路径/作品库 --request create.json`，HTTP 使用 `POST /api/world/commands`。请求示例：

```json
{
  "command": "object.create",
  "mode": "preview",
  "worldId": "<world.id>",
  "baseRevision": "<world.revision>",
  "objectId": "<新生成的小写 UUID>",
  "documentType": "character",
  "sourcePath": "documents/characters/new.json",
  "content": "{\"姓名\":\"新角色\",\"生命\":9007199254740993}\n",
  "actorRef": { "kind": "tool", "id": "local-cli" }
}
```

World 身份和版本来自同一次查询；类型取自当前工程定义。v2 使用 `design-data/`，v3 使用 `documents/`。客户端生成新的 UUID；已有对象或资源身份不能复用。路径还要通过大小写、Unicode NFC、登记保留位置、文件／目录冲突及跨平台文件名检查。正文最多 262144 个 UTF-16 单元，路径最多 1024；HTTP / CLI 请求继续限制为 1 MiB，世界读取限制为 64 MiB 正文。

预览零写入，返回预计 revision、对象投影、`changes` 和 `proposed` 提案。将同一请求的 `mode` 改为 `apply` 后，锁内重新检查世界及目标位置。成功返回独立的已提交回执。命令不会覆盖已存在文件，没有 `force`，也没有用户撤销／删除反向命令。超时后先查询或恢复，核对是否已经创建，再决定后续操作；不要自动换一个身份重试。

## 正文与登记的恢复

创建登记只包含身份、来源、已有类型、解析配置以及空关系／素材绑定，属性仍来自正文。日志使用 `viento-source-transaction` **version 2**，严格限定一对文件：文档根内的新正文、`metadata/documents/<UUID>.json`。两个 before 状态都为“不存在”，after 镜像完整持久化；继续支持 0.0.3 已有的 version 1 属性事务。

| 中断时机 | 恢复结果 |
| --- | --- |
| 发布意图后、正文或登记发布中、提交标记之前 | 先撤回登记，再撤回正文；恢复为两个文件均不存在 |
| 提交标记之后 | 先补齐正文，再补齐登记；恢复完整对象 |
| 恢复过程中再次退出 | 使用同一意图重入，结果保持上述方向 |

新文件使用排他发布。恢复前一次性检查全部镜像和目标；目标只能不存在或精确匹配该事务的 after 摘要。外部内容、符号链接、身份或路径不匹配时保留现场，不覆盖其他文件。回退可能留下空目录，不删除目录内第三方文件。读取屏障、最后回执、启动恢复、显式恢复与 [批量提交协议](WORLD_TRANSACTIONS.md) 相同；CLI `--recover` 和 GUI **恢复未完成的提交** 可处理两种日志。

这是当前 Node 宿主的新创建命令保证，旧 **新建文档** 入口仍使用原有流程。`changeset.apply` 仍只接受现有对象的属性修改，不能混合创建、关系和资源动作。旧 0.0.3 遇到未完成的 version 2 日志会阻止读取并拒绝恢复，需要使用支持此协议的版本完成恢复；成功提交后的 v2 / v3 作品可以继续通过原有归档格式互通。

## 验证与边界

[验证记录](test-results/world-create/results.json) 覆盖纯预览、精确正文／登记、解析规则、三端命令契约、真实版本冲突、UI 草稿保护，以及 SIGKILL 后恢复与恢复重入。新增对象已验证通过原生桌面导出 → 移动存储导入／导出 → 桌面恢复，身份及正文不变；移动端并未实现 `object.create` 命令。

范围仍为 Linux 本机进程中断；外部编辑器、旧应用及恶意并发路径替换不遵守当前锁和读取屏障，不宣称硬件断电或跨网络文件系统事务。后续源码已接通 [关系追加与恢复](WORLD_RELATIONS.md)，创建阶段的历史验证记录保持不变。0.0.4 Linux 安装包验收见 [版本记录](RELEASE_0.0.4.md)；通用资源内容事务、混合 ChangeSet、永久撤销历史与 Android 语义写入仍待实现。后续已有 [资源绑定](WORLD_RESOURCES.md) 与 [Scene2D 冻结构建](PROJECT_BUILD.md)；各平台安装验收单独见 [当前状态](STATUS.md)。

```sh
VIENTO_TEST_ARCHIVE_BINARY="$PWD/src-tauri/target/debug/examples/workspace-archive" \
VIENTO_MOBILE_STORE_BIN="$PWD/src-tauri/target/debug/examples/mobile-storage" \
node --test --test-concurrency=2 scripts/tests/world-object-create.test.mjs scripts/tests/world-browser.test.mjs
```
