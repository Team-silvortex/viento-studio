# fast-uri 依赖安全修复

2026-10-25，0.2.4 发布后的修复提交。仅将 Ajv 的间接依赖 `fast-uri` 从 3.1.8 更新至 3.1.9；应用版本、直接依赖、Rust 锁文件及作者数据不变。[锁文件核对](lock-check.json)确认只变更一个依赖记录的版本、下载地址和完整性摘要。

## 四项公告

[npm 修复前审计](npm-before.json)在同一个包中检出以下四项，级别为两项中危、两项低危，与推送提示一致；全部公告列出3.1.9为3.x修复版本。

- [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg)：编码协议名被错误解释。
- [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h)：相对路径规范化改变目标。
- [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr)：主机名规范化丢失输入信息。
- [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp)：suffix相对引用首段冒号被解释成协议。

Ajv只在13份测试模块中使用，用于World操作、资源包与3D声明的Schema校验。生产代码没有直接使用Ajv或fast-uri。GitHub仓库告警API因现有凭据权限返回403，本轮使用官方npm审计和公告核对；不据此声称GitHub面板已刷新关闭。

## 验证

执行 `npm update fast-uri --package-lock-only --ignore-scripts --no-audit --no-fund` 更新锁文件，再用 `npm ci --ignore-scripts --no-audit --no-fund` [重新安装](npm-ci.log)。[修复后 npm audit](npm-after.json)为 **0 项漏洞**，实际安装版本3.1.9。

13份Ajv使用模块加版本与源码归档测试共 **284项：277通过、7条件跳过、零失败／取消**，详见[日志](focused-tests.log)与包含完整命令的[执行回执](focused-exit.json)。跳过项为未提供原生工具的归档互通检查；本轮没有重复全应用、桌面安装或引擎测试。

[旧行为](uri-regression-before.json)与[第一次新行为](uri-regression-after.json)分别保存。前三组修复通过；第四组初次照用公告中只含`reference: suffix`的字面样例，结果不符合原断言，没有把这次结果记作4/4。核对3.1.9自带 `test/reserved-path-normalization.test.js` 后，真正无authority的相对路径测试还指定`scheme: x`。

[第四项定向验证](suffix-regression.json)使用无害的`a:b`：在上述上游选项下，旧版normalize输出`a:b`，新版输出`a%3Ab`，重新解析后没有scheme；普通路径及后段冒号保持。直接serialize在两个版本本来都安全，首次对此旧行为的预期已纠正，不作为新增修复。没有将所有无效URI的normalize输出当成可安全导航地址；应用也不直接调用这些接口。

## 另外发现的Rust依赖事项

定位期间执行的[Tauri Rust审计](cargo-tauri-before.json)另外报告zip4.6.1的三个extract/stream公告，及Tokio1.53.1的AsyncFd unsound公告；这些不是此次四项npm告警，**未在本轮修复，也未声称全项目审计归零**。

[只读可达性核对](rust-and-ajv-review.json)：本项目导入自行校验路径、拒绝符号链接并独占创建普通文件，不调用受影响的ZipArchive::extract或ZipStreamReader，也不恢复归档Unix权限。Tokio相关构造器未由应用源码直接调用，传递依赖尚未完整审计。zip修复跨至9.x，Tokio有1.53.3补丁；后续应独立验证兼容性。已有glib本地修复保持。
