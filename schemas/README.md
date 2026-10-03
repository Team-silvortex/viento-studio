# 工程格式定义

[工程布局](../docs/WORKSPACE_LAYOUT.md) · [工程模板](../docs/PROJECT_TEMPLATES.md) · [当前架构](../docs/ARCHITECTURE.md)

- `workspace-v3.schema.json`：新通用项目的公共清单，使用 `documents`、`templates`、`metadata` 和一个 `main` 素材存储；项目可定义文档类型、目录、解析方式和模板。
- `workspace-v2.schema.json`：旧项目公共清单，继续使用 `design-data`、`data-template` 与独立元数据。
- `asset-v1.schema.json`：素材身份、类型、位置、内容指纹和旧路径。
- `document-v1.schema.json`：文档身份、源文件位置和附件关联。
- `resource-package-v1.schema.json`：选择式资源包清单、根身份、类型及外部依赖、文件摘要；见 [资源包契约](../docs/RESOURCE_PACKAGES.md)。

这些是通用格式定义，随应用分发。具体作品记录保存在作品库内的 `workspace.json` 与 `metadata/`。

实验性 semantic v1 另提供 `world-v1`、`object-v1`、`world-projection-v1`、`command-descriptor-v1` 和 `changeset-v1` Schema。它们描述只读投影、查询 / 属性命令及 ChangeSet 提案形状，不是 workspace v4，也未启用模型持久化。单属性保存返回独立回执，不把 `proposed` 提案当作持久提交。权威来源及执行边界见 [ADR 0002](../docs/adr/0002-world-projection-and-property-authority.md) 和 [ADR 0003](../docs/adr/0003-single-property-command.md)。

JSON Schema 描述字段结构。运行时还会检查文件名与 ID 一致性、身份和位置唯一性、路径可移植性及链接边界。正文中已有的业务字段不复制到登记文件。规则实现位于 `scripts/lib/workspace.mjs`，归档与 v1 兼容实现位于 `src-tauri/src/workspace.rs`。

`transaction-receipt-v1` 是批量属性提交、对象创建、关系追加与资源绑定的独立持久回执，不把 `changeset-v1` 的提案状态改成提交状态。`changeset.apply`、`object.create`、`scene.create`、`scene.update`、`projection.create`、`projection.update`、`relation.add` 与 `resource.bind` 的输入形状通过 CommandDescriptor 分发；创建、关系追加和资源绑定没有用户撤销反向命令。`scene.create` 的开发实现以第 5 版受限意图新建场景正文及派生依赖登记，返回同一回执格式，没有用户撤销反向命令，见 [场景创建](../docs/PROJECT_BUILD.md#场景创建命令)。`projection.create` 使用第 6 版受限意图新建 OC 投影正文和派生登记；模板快照与配置使用内核运行时严格校验，World 对象 schema 仅声明派生摘要。见 [多份投影](../docs/OBJECT_PROJECTIONS.md)。`projection.update` 以第 7 版受限意图更新投影标题／配置和新增图片绑定，固定身份、来源与模板，并保留额外登记。`scene.update` 使用第 8 版受限意图更新既有场景与必要依赖，固定身份／类型／路径并保留额外登记。现有受限事务意图与回执不等于通用命令日志或 workspace v4。见 [ADR 0004](../docs/adr/0004-recoverable-source-changesets.md)、[ADR 0005](../docs/adr/0005-recoverable-object-creation.md)、[ADR 0006](../docs/adr/0006-recoverable-relation-registration.md) 和 [ADR 0007](../docs/adr/0007-recoverable-resource-binding.md)。
