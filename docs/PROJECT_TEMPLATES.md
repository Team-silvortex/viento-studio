# 工程与文档模板

本页描述当前源码的声明式模板契约。日常界面操作见 [项目工作流](PROJECT_WORKFLOW.md)，发行与平台状态见 [当前状态](STATUS.md)。工程模板包与 OC 投影子模板已纳入 [0.0.6 源码交付](RELEASE_0.0.6.md)。

## 模板各自的职责

| 概念 | 内容与作用 | 当前状态 |
| --- | --- | --- |
| 文档模板 | 一份 Markdown、文本、JSON 或 YAML 起始正文；类型可指定它供新文档使用 | 工程内独立维护，界面可编辑、预览和保存 |
| 工程起始模板包 | 一组文档类型及其模板文件，创建工程时复制进去 | 内置包选择已实现；无第三方包安装或升级界面 |
| OC 投影子模板 | 从共同 OC 生成不同用途的配置；继承字段并保存完整快照 | 已接入，见 [多份投影](OBJECT_PROJECTIONS.md) |
| 未来的类型包 / 工程类型插件 | 路线图中承载更完整对象语义与工程能力的扩展契约 | 当前工程模板包不等同于该机制，尚无完整插件实现 |

文档模板不是必填字段检查表，不限制正文之后增加的内容，也不执行脚本或替换变量。工程起始模板只决定初始副本；运行引擎的能力由独立构建适配器决定。选择“游戏”不会自动创建可执行游戏，选择“软件设计”也不会执行流程或构建程序。

## 内置工程模板包

新建默认选择空白工程。桌面与 Android 原生宿主读取同一份 [工程模板目录](../scripts/lib/project-templates.json)。

| 模板包 | 起始类型 | 模板正文格式 |
| --- | --- | --- |
| `org.viento.blank` | 文档 | Markdown |
| `org.viento.oc-game` | 设计文档、角色、能力、道具、关卡、任务、阵营、规则 | Markdown |
| `org.viento.oc-literature` | 作品说明、人物、大纲、篇章、地点、组织、设定 | Markdown |
| `org.viento.oc-drama` | 剧作说明、人物、幕、场、舞台提示、道具 | Markdown |
| `org.viento.software-design` | 文档、组件、接口、流程、验证 | Markdown、YAML |

游戏模板侧重交互规则与设计，文学模板侧重人物和篇章，戏剧模板侧重幕场、台词与舞台调度。角色背景保留在角色／人物自身模板中。文学大纲、篇章及戏剧幕、场使用 `prose` 解析，带冒号的台词保留为正文；游戏类型使用通用字段与章节，不绑定某套游戏数值体系。

正文和登记最初为空；每个新工程都有自己的 UUID、类型清单和模板文件。不同工程可使用同样的类型标识和模板文件名，彼此不导入正文，也不共享可变配置。

## 包格式与实例化

物理目录位于 [workspace-layout.json](../scripts/lib/workspace-layout.json)，工程模板包位于 [project-templates.json](../scripts/lib/project-templates.json)，二者与内核解析实现分开。

每个包声明：

| 字段 | 用途 |
| --- | --- |
| `format: "viento-project-template"`、`schemaVersion: 1` | 包格式和 schema 版本 |
| `packageId` | 命名空间标识，例如 `org.viento.oc-game` |
| `version` | 包自身的三段数字版本，例如 `1.0.0` |
| `label`、`description` | 新建选择器中的名称与说明 |
| `documentTypes` | 本包完整的文档类型定义 |
| `templates` | 相对模板路径到完整正文的映射 |

包标识以点分隔，每段以小写英文字母开头，只含小写字母、数字和短横线；它与文档类型 ID 使用不同约束。模板映射必须与类型引用一致，模板文件树必须合法。创建时，宿主先校验包和引用，再写入临时工程目录，成功后交给作品库。包不存在、目录冲突或写入失败会明确失败，不静默切换到另一套工程模板。

实例化复制完整定义及文件，不把工程连接到应用安装目录。之后打开、编辑、导出和恢复工程，只依赖工程内的定义和文件；即使来源包已经移除，工程仍可使用。

## 来源摘要、版本与兼容

`workspace.json` 的 `projectTemplate` 记录创建来源：

```json
{
  "projectTemplate": {
    "packageId": "org.viento.blank",
    "version": "1.0.0",
    "digest": "sha256:<64 位十六进制摘要>"
  }
}
```

`digest` 是将包序列化为对象键有序的 JSON 后计算的 SHA-256，包含 `sha256:` 前缀。它描述创建时使用的包，不是当前工程目录的校验和，也不取决于新工程的名称和 UUID。上例摘要是格式占位说明，实际创建时由宿主计算。

修改工程里的类型和模板不会改写该来源记录。应用版本、包版本、包 schema 版本和 workspace 格式版本各自独立。升级应用或内置模板包不会自动改写既有工程；需要采用新定义时，使用下文的显式检查与应用流程。

旧 `org.viento.oc-narrative` 保存在目录的 `compatibilityTemplates`，保留原版本、类型、正文和摘要，不出现在新建选择器中。未传模板 ID 的旧宿主调用，以及没有显式类型的历史 v2/v3 工程，仍使用原六种 OC 默认类型。当前新建界面明确提交所选包 ID，默认包必须位于可选 `templates` 列表；不会把旧作品自动改成游戏、文学或戏剧分支。

## 项目类型的声明

`workspace.json` 中的 `documentTypes` 是项目的文档类型注册表。已登记文档通过 `documentType` 选择规则，文件名和目录不会覆盖它。

```json
{
  "id": "species",
  "label": "种族",
  "directory": "species",
  "parserProfile": "structured",
  "template": "species.yaml",
  "parserOptions": { "titleField": "名称" },
  "fieldGroups": [
    { "title": "生命特征", "fields": ["灵魂数量", "可繁衍"] }
  ]
}
```

这是一项类型定义，放入 `documentTypes` 数组；对应的 `templates/species.yaml` 可以写为：

```yaml
名称: 新建种族
灵魂数量: 0
可繁衍: false
关系: []
补充: null
```

| 字段 | 约束与作用 |
| --- | --- |
| `id` | 小写英文字母开头，随后可用小写字母、数字、下划线或短横线，最多 64 个字符；创建后界面不重命名 |
| `label` | 界面显示名，与类型 ID 分开 |
| `directory` | 相对工程正文根的默认子目录；空字符串表示正文根，不移动已有文件 |
| `parserProfile` | `structured` 或 `prose` |
| `template` | 可选，相对模板根的文件路径，支持 Markdown、文本、JSON、YAML；新建沿用其扩展名 |
| `parserOptions` | 标题字段、叙事允许字段、长字段及结束边界 |
| `fieldGroups` | 按精确字段名定义展示分组 |

一个项目最多 100 个类型；类型 ID 和默认目录不能重复，路径不能越界。新建和模板设置检查隐藏目录、`node_modules`、保留名称及单段文件名长度等跨系统约束。已有无效配置可打开修正，不会因此改写正文。

### 解析与展示规则

- `structured` 识别字段及通用内容块；`prose` 保留对白中的冒号，仅识别 `allowedFieldKeys` 明确列出的字段，缺省为 `_header`。
- `titleField` 使用顶层标量字段作为展示标题，对象和数组不会被误当作标题。
- `multilineFieldKeys` 允许长字段中包含有冒号的子内容；遇到下一长字段、`boundaryFieldKeys` 指定字段或普通块边界时结束。
- `fieldGroups` 按精确字段名分组。数组、对象、0、false、null、重复字段及未选择的内容块仍保留；没有分组时按原文顺序展示。

字段名称最多 120 个 UTF-16 单元，每类字段规则最多 200 项；展示分组最多 50 组，同一字段不能跨组重复。具体结构见 [类型 schema](../schemas/project-type-v1.schema.json)。项目定义优先于文档登记中的旧解析配置，`legacy-hero` 仅作为没有显式项目定义时的兼容入口。

### 模板保存与冲突

界面接受最多 1 MB 模板正文，保存路径为 `templates/types/<类型标识>/<内容指纹>.<扩展名>`。先完整写入新模板，再原子切换项目清单，避免中断后清单指向半份文件。成功后只清理本次替换的、内容未被外部修改且无引用的旧自动模板；手写或导入模板保留。

配置版本同时包含清单与模板内容。另一个窗口或外部编辑器修改后，旧保存请求会报告冲突，应重新打开模板窗口再编辑。HTTP 写入沿用文档服务的会话及认证。项目模板随完整迁移包携带；指定模板缺失时提示问题并保留空模板，不从另一个内置包补写内容。

## 统一调用路径

```text
项目清单 + 稳定文档登记
          ↓ resolveDocumentDefinition
类型、解析方式、字段规则、展示分组
          ↓ parseSourceContent
标题、原始类型值、有序内容块
          ↓ buildDocumentLayout
          ├── 编辑器展示与素材草稿预览
          ├── 模板预览
          └── HTML / Markdown 导出
```

标准化与索引属于派生产物，不把模板覆盖进已保存正文。解析引擎可识别模板之外的字段和内容块；工程模板本身不安装解析器代码或运行时。

## 校验与已有项目采用定义

```sh
npm run workspace -- check-project --root /绝对路径/作品
npm run workspace -- apply-definition --root /绝对路径/作品 --definition /绝对路径/项目定义.json
npm run workspace -- apply-definition --root /绝对路径/作品 --definition /绝对路径/项目定义.json --write
```

`check-project` 检查源文件、素材指纹、类型与模板。`apply-definition` 默认只检查，加 `--write` 才应用，并把清单变更日志放在 `.viento/migrations/`。它不搬动文件，不改写正文、UUID、关系或素材绑定；缺少现有类型、模板不完整或路径无效时拒绝应用。重复应用相同定义不新增变更日志。

省略 `template` 的类型使用自动生成的 Markdown 起始正文；指定模板时，文件必须存在、可解析且不超过 1 MB。示范定义见 [官方示范](examples/README.md)。

当前支持 v3 通用目录和 v2 兼容目录。采用显式定义不要求为更新解析器搬动素材，也不是升级来源模板包的自动同步操作。文件布局与外置素材定位见 [作品库布局](WORKSPACE_LAYOUT.md)。
