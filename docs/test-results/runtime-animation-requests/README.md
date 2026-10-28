# 动画请求身份与接受／执行位置

2026-10-28，0.2.5之后开发工作树。Godot适配器0.35.0新增独立 `runtime.animation-requests` 观察能力，将动画入队、实际业务回执和中止清理串起来。含动画工程生成0.35.0，无动画工程仍由0.34.0生成；作者格式、业务协议4／7／10／11、有限累计预算和应用版本保持。安装程序未更新，本轮未提交或推送。

## 合同与边界

`VIENTO_ANIMATION_REQUEST:` 协议1提供 accepted／applied／discarded 三种观察。accepted复用既有单会话预约序号作为requestId，保存真实Engine idle／physics帧对；applied同时匹配全局FIFO头、已准入的原动画命令、commandSequence、当前executionFrameIndex和精确帧对。来源由冻结构建中的binding.declaration派生，拒绝在观察中另塞source。逐实例目标和场景目标共用同一FIFO。

接收seek时校验完整动画时长，执行时仍按届时选定的片段校验。接受成功不能替代执行成功。discarded只记录abort清队列点输出的观察，不推断每个被清理请求都曾执行失败。丢失applied观察时，即使旧命令账本已记录成功，新请求也保持pending；pending表示缺少终态证据，不证明命令尚未执行。

DTO保留最近128条终态及全部未决请求；未决上限仍为64，合计最多192条。既有256次接受预算、命令账本和其他运行限额不重置。读取器独立限制512次观察前缀尝试、单行16KiB UTF-8（去掉行尾）和128条诊断。取消、超时或消费者异常保留已准入事实，并将最终观察标记incomplete；没有完整终态时不补造成功或清除记录。

生成层只转换新工程内的动画队列副本；原GDScript模板逐字节保持。库存核对新helper、sidecar、原始副本及重新推导的转换结果，宿主完整对比重生成backend，避免删除能力绕过读取器。预算／时钟／封套的JavaScript库存接口增加受限固定文件字节视图，会改变生成指纹；旧冻结构建应显式重建，不应绕过指纹检查。

## 验证

[完整应用检查](full-check.log)：**8569项，8021通过、548条件跳过，零失败／取消**；版本一致性、1422个JavaScript语法检查和API契约预检通过。[源码守卫](full-check-exit.json)记录1394份生产／测试来源全程不变。未配置原生工具的548项跳过不算引擎验收。

- [最终定向回归](targeted-final.log)：150项，144通过、6条件跳过，零失败；覆盖新合同、生成库存、宿主和旧预算／精确帧／因果链路，[执行记录](targeted-final-exit.json)确认冻结来源。
- [真实Godot主组](native-final.log)：**23／23通过，零跳过**，包括新请求7案、旧精确业务帧4案、预算时钟7案、因果锚点4案和逐实例ZIP交付1案。[执行记录](native-final-exit.json)确认源码全程不变。
- [真实Godot兼容组](native-compatibility.log)：**7／7通过，零跳过**，覆盖作者事件失败、A→B→A访问隔离、动画ZIP脱离原路径运行、第257次请求拒绝、事件／音频／动画执行次序、状态机初始进入和旧p9工程。[执行记录](native-compatibility-exit.json)保存精确筛选命令及来源守卫。
- [核心独立复核](core-review.log)、[生成层检查](backends.log)和[宿主首轮](host-integration-first.log)保留为开发记录；[新六案首轮](native-first.log)也通过，随后追加_ready案，最终主组在最终测试源码上重新运行。

最终共30项真实无头案例，分组串行执行。上述定向／完整检查有重叠，不相加为产品覆盖率。

| 新原生案例 | 实际观察 |
| --- | --- |
| 同回调FIFO | 6接受、6应用，各自对应原命令与精确执行位置 |
| 逐实例跨帧 | 两实例4请求共用FIFO，实际idle和physics帧在接受与应用之间均前进 |
| 先选片段再seek | 3接受；选择应用成功，后续seek超片段范围，2请求随abort清理 |
| 取消与尾部轮转 | 160次状态提交后取消，4请求保持pending，预算窗口和业务位置淘汰不丢请求来源 |
| 终态留存 | 148命令全部成功；中途保留128终态加4未决，最终留request21–148，原148条命令账本完整 |
| 队列容量 | 前64请求接受后清理，第65请求拒绝，无新身份、无额外预算扣除 |
| 作者_ready | 实际stdout顺序为runtime ready、作者同步接受、deferred应用，2请求的未决中间态可见 |

新七案均使用实际宿主构建和非smoke无头运行、真实Engine探针；每案35份作者文件和50份来源摘要前后相同，session与返回值一致，临时运行目录已清理，stderr为空。延后执行的夹具只控制既有flush门，不伪造时钟。单元／host合成时钟仅证明合同和异常边界，不作为引擎时间证据。

工具：Node24.21.0，Linux x86_64，Godot `4.7.2.stable.viento_audiofix1_ed1daf0bf`，SHA256 `d0214fafa4af018589761b772f38be02b421cd021ed69c45c1d7a4bcd2acbb04`。这不是Studio新安装验收。

## 记录与后续

本轮仅增加动画队列观察及会话／任务DTO，尚无对应UI、Bevy实现或Rust／WASM变更；音频／事件的请求身份与双时刻尚未接通，也未开放continuous模式。可据此继续定义其他排队端口的共同合同，再评估完整账本裁剪和持续运行。

新七案证据位于 `native-final-viento_animation_requests_evidence/`，各目录含stdout、session、冻结构建、作者及源码摘要。重复较多的 `*-updates.json.gz`（请求、因果及帧位置快照）采用无损gzip保存；[压缩记录](compressed-evidence.json)保存原始SHA256和压缩前后体积。首次六案日志单独保留，最终七案及历史回归重新在最终冻结源码上执行。

[保留审计](preservation.json)、[最终源码核对](final-source-verification.json)、[评分审查](score-review.json)、[图谱校验](atlas-check.json)与[文档链接检查](docs-links.json)记录交付边界。核对本轮开始前13890个文件，没有缺失；11802份既有测试证据、93份既有GDScript、172份Rust源码、应用版本和WASM保持。首次保留检查仅因审计白名单漏列本轮新增说明的根README而报错，[首轮记录](preservation-first.json)保存该差异；核对实际补丁并补齐白名单后通过。

图谱新增1功能、3实现、3绑定、12评分，达到179功能／538实现／748绑定／2992评分／143工作流；旧评分和证据保持。新评分为实现3／验证3／解耦3／交付2，不表示已发布或安装。
