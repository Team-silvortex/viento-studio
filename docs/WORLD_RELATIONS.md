# 可恢复的对象关系

0.0.4 纳入 `relation.add`：GUI、CLI 和 HTTP 共用可移植规划器，在 workspace v2 / v3 的现有文档登记中添加关系。正文、对象身份和归档格式不变。开发阶段的 0.0.3 验证记录保留原样，首次纳入版本的验收见 [0.0.4 记录](RELEASE_0.0.4.md)，当前平台状态见 [STATUS](STATUS.md)。

## 使用

编辑模式打开 **世界与对象**，选择来源对象，点击 **添加关系**。选择类型、目标及可选标签，再 **预览关系 → 保存关系**。引用（`references`）用于关联设定；归属（`part-of`）把来源放入目标的附属内容，同一故事可以有多个归属。

两端都必须是已登记、原文可用的对象；可以连接未知文档类型，因为操作只编辑登记。禁止自连接、重复的“类型 + 目标”和直接或间接归属循环；引用关系允许形成环。已有其他种类关系及其扩展字段原样保留，本入口只新增上述两种关系。

修改类型、目标或标签会使预览失效。版本冲突、重复或循环错误保留草稿，不能直接保存旧预览；关闭、刷新或切换对象时确认是否丢弃。关系草稿不能与待提交属性队列混用，也不跨页面重启持久保存。保存后全量重建文档索引，使两端的归属导航和附属内容一起更新；重建失败会明确提示关系已经保存。

CLI 使用 `node scripts/world.mjs --root /完整路径/作品库 --request relation.json`；HTTP 使用 `POST /api/world/commands`。两者接受同一请求：

```json
{
  "command": "relation.add",
  "mode": "preview",
  "worldId": "<world.id>",
  "baseRevision": "<world.revision>",
  "objectId": "<来源对象 UUID>",
  "objectRevision": "<来源对象 revision>",
  "targetObjectId": "<目标对象 UUID>",
  "targetRevision": "<目标对象 revision>",
  "kind": "part-of",
  "slot": "共同背景",
  "actorRef": { "kind": "tool", "id": "local-cli" }
}
```

身份及版本来自同一次 World 查询。预览零写入，返回关系、预计 revision、`proposed` 提案和登记修改摘要；将 `mode` 改为 `apply` 后，锁内重新读取并校验全部条件。HTTP 预览／保存／恢复共用写鉴权、JSON 请求上限和限流；`actorRef` 只是调用者标签。标签最多 200 个 UTF-16 单元，可为空；拒绝未配对代理字符。登记前后各不得超过 1 MiB，世界正文读取仍受 64 MiB 上限约束。

## 保真与恢复

规划器定位原始 JSON 的 `relations` 数组，插入一个关系对象；字段不存在时只插入该字段。原有空白、换行、字段顺序、数字字面量和未知字段不经过 JSON 重序列化。重复键、无效结构或不能验证为单次插入的登记会拒绝。正文、素材及其他登记不被修改。

World revision 继续描述现有投影的规范化语义状态。预览后仅修改登记排版不会使该 revision 变化；应用在最新排版上重新规划，保留外部格式修改。发布及恢复另使用登记原始字节的 SHA-256，防止覆盖其他内容。影响对象语义的外部修改会使旧命令失效。

沿用 [批量事务](WORLD_TRANSACTIONS.md) 的锁、读取屏障及恢复入口，新增 `viento-source-transaction` **version 3** 意图，限定一个已存在的 `metadata/documents/<来源 UUID>.json`。这不是 workspace v3 的新定义，也不是任意元数据修改协议。意图记录新增关系、登记的前后镜像及其摘要，以及其余登记的规范化摘要。

恢复必须先验证：镜像严格等于一次合法关系插入；来源身份／路径不变；其余登记匹配；旧图、新图均有效；当前文件等于前或后镜像。然后才开始写入。提交标记前回退原登记，标记后恢复新登记；恢复中再次退出可重入。只跳过本事务已验证名称的临时登记文件，其他额外文件、链接、损坏镜像和外部冲突继续阻止恢复，保留数据与日志。

GUI 的 **恢复未完成的提交**、CLI 的 `--recover` 和编辑宿主启动恢复使用同一实现。待恢复期间，旧编辑器、World 查询、登记读取及 Node／原生导出保持屏障。恢复保留界面关系草稿，使其重新预览，不会自动重发修改。

## 兼容与验收边界

version 1 属性事务、version 2 创建事务继续可恢复。旧 0.0.3 不支持 version 3 意图，会拒绝恢复；必须用支持此协议的源码版本处理，不能删掉 `active` 绕过屏障。完成后的共享归属已通过 v2 / v3 原生桌面导出 → 原生移动存储导入／索引／导出 → 桌面恢复，登记原始字节、对象身份及 World revision 一致。

本轮自动回归覆盖图约束、GUI 草稿、HTTP / CLI 一致、并发命令、实际 SIGKILL、恢复重入、外部冲突和归档互通，见 [验证记录](test-results/world-relations/results.json)。运行命令：

```sh
VIENTO_TEST_ARCHIVE_BINARY="$PWD/src-tauri/target/debug/examples/workspace-archive" \
VIENTO_MOBILE_STORE_BIN="$PWD/src-tauri/target/debug/examples/mobile-storage" \
npm run check -- --app-only
```

尚无关系删除／用户撤销、自定义关系类型写入、资源绑定命令、混合 ChangeSet、Build 快照或 Android 语义写入。保证范围为 Linux 本机进程中断，不代表硬件断电、网络文件系统或 Windows／macOS 验收；外部写入方在最后校验与替换之间仍可能竞争。开发和安装验收使用合成测试作品，不修改官方作品；0.0.4 Linux 安装包结果见 [版本记录](RELEASE_0.0.4.md)。
