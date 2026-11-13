# 二维相机世界边界：2026-11-11 工作树验证

应用保持0.2.9，本轮未提交、发布或更新安装程序。相机作者v1保持原规则；显式启用世界边界才写相机作者v2，关闭并保存则明确降回v1。Godot执行描述符更新为0.44.0；仅包含有边界相机的生成工程使用0.44.0，无边界相机生成层仍为0.43.0。Scene2D、组装、运行观察线协议和已有创建事务日志v13保持。

## 交付与语义

“构建与运行” → 选场景 → “运行主相机” → 勾选“启用世界边界”，填写左／上／右／下，审阅完整作者JSON后显式保存。四值有限且位于±100000，支持小数；左小于右、上小于下。固定中心或逻辑目标加偏移形成期望中心，再按实际`viewport / zoom`可见尺寸夹取中心；某轴世界范围小于可见尺寸时，在该轴中点取景。边界不裁剪像素、不限制角色移动，也不把运行夹持结果写回作者中心或偏移。

构图显示青色世界边界、橙色实际中心与取景框、粉色期望中心及两者连线；全部构图包含越界意图点，适配相机只拟合实际框。边界、开关、目标、偏移与来源均纳入表单审阅；改变后撤销旧票据，取消和临时视图操作不写作者数据。关闭边界后忽略其休眠草稿值，但再启用可保留未保存的四边输入。

核心合同、纯几何、表单／Canvas、宿主能力准入和Godot限界实现分离。Godot在原Camera2D层外增加独立helper：先算逻辑位置加世界偏移，再夹取全局相机中心，原生offset清零，避免偏移在原生limits之后逃逸。使用当前真实viewport尺寸，并在窗口变化后重算；角色、物理求解与动画视觉子节点没有被改写。含v1/v2的组装只给v2成员添加完整v2旁文件和限界脚本；其派生v1声明与完整v2由库存成对校验。

`scene.camera2d.limits2d`与基础`scene.camera2d`必须在成员、组装、已注册provider和真实producer分别声明；删除cap不能让有边界声明静默降级。操作和格式见[相机指南](../../SCENE_CAMERA2D.md)。

## 分层证据

| 证据 | 实际范围 |
| --- | --- |
| [最终新增专项](targeted/final-source.log)、[23来源前后守卫](targeted/final-source.json) | 47项：42通过、5原生环境条件跳过，零失败／取消。纯合同／几何／原文20、UI5、Canvas2、准入7、作者服务／迁移／恢复5、后端库存3；原生5项另按下方真实工具运行 |
| [纯领域回执](targeted/viento-camera2d-limits-pure-evidence.json)、[原新组合](targeted/viento-camera2d-limits-pure-final.log) | 新20＋旧合同14／frame15／edit3，共52/52。严格getter／隐藏／稀疏拒绝、缩放两端、各轴夹持／小世界、目标UUID、fit范围、no-op、BOM／CRLF及精确版本切换 |
| [作者与准入](targeted/viento-camera2d-limits-root-frozen.log) | 新12/12：preview无写，三作者文件创建及既有事务头回执；保存仅相机正文、冲突保留、显式降v1；完整四文档包迁移至合法v2目录，原作者移离后重建相机UUID和原字节一致；正确checksum伪造无效边界／v1夹带边界被拒；冻结依赖恢复验证v2 |
| [最终Chrome](browser-final-2026-11-11/browser.json) | Chrome156真实HTTP，107断言、零浏览器错误；38源码前后及当前一致，31作者夹具文件快照。v2固定创建／实例跟随保存、期望与实际构图、拖动不改边界／目标、取消无写、无效清框、显式v1降级只审阅；三语390px四输入、开关、构图与保存／取消可达，7张截图分别目检 |
| [原生汇总](native-frozen-final-2026-11-11/summary.json)、[最终日志](native-frozen-final-2026-11-11/native-final.log)、[来源](native-frozen-final-2026-11-11/source-guard.json) | Godot5/5，无跳过；33相机观察样本、3PNG。固定分数范围／小世界／resize／场景重入；follow偏移先夹取、同OC实例、旋转与视觉动画隔离；21步原CharacterBody2D求解运动观察 |
| [离线工程](native-frozen-final-2026-11-11/offline-delivery.json)、[ZIP](native-frozen-final-2026-11-11/camera-limits-project.zip) | 标准buildProject→库存检查→正式工程ZIP→严格交付验证；原作者/build路径移离后解包、import、script-check和run，完整v2、派生v1及独立helper均保留，实际中心夹持、演员位置仍为原值，作者字节不变 |
| [v1基线回执](native-frozen-final-2026-11-11/v1-receipt.json) | 旧无边界相机30份生成文件、sourceMap、capabilities与生成版本相同。实现源码参与身份，backend.sha256随真实变化更新；全局descriptor0.44不冒称旧指纹完全不变 |
| [完整应用](full-check.log)、[状态](full-check-status.json)、[前](full-check-sources-before.json)／[后](full-check-sources-after.json) | `npm run check -- --app-only`：9294项，8618通过、676按环境条件跳过，零失败／取消。1595份JS语法、版本一致性与API预检通过；2609份代码／测试／准备来源前后不变，包括新GD；原生条件跳过不计作通过 |
| [保留证明](preservation.json) | 13020份已跟踪历史证据与78份旧后端GD／文本逐字节等于HEAD；开工前全部82份后端脚本（含未提交相机／物理层）均不变；此前43／39／104／42份专题与开工SHA一致 |

原生使用Godot4.7.2独立音频清理修订版，实际工具SHA和各执行阶段在原始记录中。图形为隔离Xvfb＋Mesa llvmpipe软件OpenGL，不外推硬件GPU、其他系统、Bevy相机、HUD或安装版。原生观察器只在隔离生成副本添加观测入口，不修改被测helper或替换角色求解；实际窗口像素另有PNG与像素分析。浏览器报告不代替原生运行，纯Canvas记录不代替像素验收。

## 初轮记录与测试边界

- 纯合同两轮均52/52；初版到最终版按审查将“全部构图”扩为包含越界期望中心点，保留[首轮](targeted/viento-camera2d-limits-pure-initial.log)与最终指纹。
- [首轮root回归](targeted/viento-camera2d-limits-root-initial.log)新测试将非有限数误当作诊断结果，实际中立请求入口已正确抛错；改为分别验证有限无效与非有限拒绝。[次轮](targeted/viento-camera2d-limits-root-second.log)3败均为新夹具：直接修改冻结plan、遗漏既有`.viento/world-transactions/head.json`回执、v2目标目录用了不合法自定义路径。修正夹具并保持生产校验，随后[第三轮](targeted/viento-camera2d-limits-root-third.log)11/11；再补冻结依赖恢复后最终12/12。
- 相机保真编辑现在先严格捕获候选，VM测试的表单模块与注入Node编辑器分属两个realm；公共dialog harness明确传递表单产生的JSON DTO，真实浏览器仍在同一realm，纯模块对getter等对抗输入测试没有转换或放宽。便携规划的VM装载同步真实能力推导导出；全局descriptor精确期望更新，旧生成工程期望保持。
- 浏览器[初版](browser-initial-2026-11-11/browser.json)88断言通过，补拍四边输入区并扩大源指纹后[输入区检查](browser-fields-check-2026-11-11/browser.json)107断言通过；最终冻结脚本与生产源再次运行在`browser-final`。初版记录保留原hash，不称最终源码证据。
- 原生探索记录保留在本专题的首次native目录；新增ZIP测试冻结后，所有5项重新录制到`native-frozen-final`，旧相机专题未被改写。`targeted/`中原`/tmp`回执保持原字节与当时路径；最终源码对应以统一定向、最终浏览器、最终原生与完整应用守卫为准。
