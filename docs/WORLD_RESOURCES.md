# 可恢复的资源绑定

0.0.5 接通 `resource.bind`：在“世界与对象”中选择对象、点击“绑定资源”，选择已登记素材并填写用途，预览后保存。GUI、CLI、HTTP 使用同一可移植规划器和版本检查。首次交付见 [0.0.5 记录](RELEASE_0.0.5.md)，当前安装包与平台验收状态见 [当前状态](STATUS.md)。

## 绑定语义

沿用文档登记的 `assetBindings`：`resourceId` 对应既有素材 UUID，`slot` 对应 `role`。支持 image、video、audio、font、text、other，不绑定具体题材或对象类型。用途由作者填写，默认 `attachment`，例如 `portrait`、`voice` 或中文用途；1–200 个 UTF-16 单元，不能全为空白。用途按原字符串区分。

同一对象可在同一用途中绑定多个资源，也可在不同用途中复用一个资源；同一对象、资源、用途的组合不能重复。已有绑定及其未知字段、`origin` 保持原样。这里建立对象与资源的关联，不把媒体标记插入正文；正文嵌入继续使用原编辑器的素材入口。

对象必须已登记且原文可读，未知文档类型也可绑定。资源必须已登记，文件可以暂时离线；界面显示可用性，但不会将“文件存在”当作内容摘要验证。绑定不导入或复制素材，不改资源登记、指纹或本机外置目录设置，不读取大文件内容；资源导入使用现有素材管理。

## 命令入口

先用 `world.inspect` 获取 World、Object 和 Resource 的 revision。请求示例中的 revision 均须替换成该快照的实际值：

```json
{
  "command": "resource.bind",
  "mode": "preview",
  "worldId": "world:…",
  "baseRevision": "sha256:…",
  "objectId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "objectRevision": "sha256:…",
  "resourceId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "resourceRevision": "sha256:…",
  "slot": "illustration",
  "actorRef": { "kind": "tool", "id": "local-cli" }
}
```

`node scripts/world.mjs --root /绝对路径/作品 --request command.json` 和受鉴权的 `POST /api/world/commands` 接受同一请求。预览零写入，返回 `binding`、`changes`、预计 World revision 和 proposed ChangeSet；保存将 `mode` 改成 `apply`，保留其余条件。执行器在登记锁内重新规划，再校验并发布。`actorRef` 是来源标签，不代替认证。

版本变化返回 `world_revision_conflict`；重复返回 `world_resource_binding_exists`。资源 revision 描述登记信息，不是实时文件内容或已验证的 Build 锁。单份登记修改前后各最多 1 MiB，HTTP 请求仍受 1 MiB 限制。

GUI 修改选择或用途后，旧预览立即失效。关闭、刷新、切换对象或新建对象需处理现有草稿；保存期间禁止重入。冲突和恢复保留草稿，不自动重试。资源绑定不能混入待提交属性队列。保存后重建索引；刷新失败时明确提示绑定已保存。草稿只存在于当前页面内存。

## 保真与恢复

仅向 `metadata/documents/<UUID>.json` 的绑定数组插入 JSON token，保留正文、已有绑定、未知字段、原始数字字面量、换行和文件权限。拒绝重复键和无效结构。格式变化不改变语义 revision，执行时保留最新格式；发布与恢复使用准确字节摘要。

在已有事务协议上增加受限 **intent version 4**，只允许一个既有文档登记追加一个绑定。这不是 workspace v4，作品与归档仍为 v2 / v3。镜像、插入结果、文档身份和路径、资源存在性、其余登记摘要全部验证后才恢复。提交标记前恢复旧绑定，标记后恢复新绑定；外部替换、资源登记变化、损坏镜像或无关临时文件会阻止恢复并保留现场。原 version 1 / 2 / 3 事务继续支持。

旧 0.0.4 执行器不认识未完成的 version 4 意图，会拒绝恢复并保持读取屏障。应先使用支持该协议的源码完成恢复，不能删除 `active` 目录来绕过检查。完成后的绑定仍能通过旧格式归档在桌面和移动存储间往返。

协议决策见 [ADR 0007](adr/0007-recoverable-resource-binding.md)，验证见 [本轮记录](test-results/world-resources/results.json)。仅验证进程中断恢复；不宣称硬件断电、网络文件系统或任意外部写入竞争的安全性。

## 后续范围

尚未实现解绑／替换、用户撤销、资源内容锁定、通用混合 ChangeSet、Android 语义写入或 workspace v4。开发源码的 [Scene2D 构建](PROJECT_BUILD.md) 已会独立复核并冻结所选资源的实际字节；资源绑定命令本身仍只修改关联。V-M2 五个首批命令的实现与真实工程／跨平台验收分别跟踪，见 [当前状态](STATUS.md) 和 [开发路线](ROADMAP.md)。
