# 作品库格式定义

- `workspace-v3.schema.json`：新通用项目的公共清单，使用 `documents`、`templates`、`metadata` 和一个 `main` 素材存储；项目可定义文档类型、目录、解析方式和模板。
- `workspace-v2.schema.json`：旧项目公共清单，继续使用 `design-data`、`data-template` 与独立元数据。
- `asset-v1.schema.json`：素材身份、类型、位置、内容指纹和旧路径。
- `document-v1.schema.json`：文档身份、源文件位置和附件关联。
- `resource-package-v1.schema.json`：选择式资源包清单、根身份、类型及外部依赖、文件摘要；见 [资源包契约](../docs/RESOURCE_PACKAGES.md)。

这些是通用格式定义，随应用分发。具体作品记录保存在作品库内的 `workspace.json` 与 `metadata/`。

实验性 semantic v1 另提供 `world-v1`、`object-v1`、`world-projection-v1`、`command-descriptor-v1` 和 `changeset-v1` Schema。它们描述只读投影、查询 / 属性命令及 ChangeSet 提案形状，不是 workspace v4，也未启用模型持久化。单属性保存返回独立回执，不把 `proposed` 提案当作持久提交。权威来源及执行边界见 [ADR 0002](../docs/adr/0002-world-projection-and-property-authority.md) 和 [ADR 0003](../docs/adr/0003-single-property-command.md)。

JSON Schema 描述字段结构。运行时还会检查文件名与 ID 一致性、身份和位置唯一性、路径可移植性及链接边界。正文中已有的业务字段不复制到登记文件。规则实现位于 `scripts/lib/workspace.mjs`，归档与 v1 兼容实现位于 `src-tauri/src/workspace.rs`。

`transaction-receipt-v1` 是 V-M3 批量属性提交、后续对象创建与关系追加的独立持久回执，不把 `changeset-v1` 的提案状态改成提交状态。`changeset.apply`、`object.create` 与 `relation.add` 的输入形状通过 CommandDescriptor 分发；创建和关系追加没有用户撤销反向命令。此阶段没有通用命令日志格式或 workspace v4。见 [ADR 0004](../docs/adr/0004-recoverable-source-changesets.md)、[ADR 0005](../docs/adr/0005-recoverable-object-creation.md) 和 [ADR 0006](../docs/adr/0006-recoverable-relation-registration.md)。
