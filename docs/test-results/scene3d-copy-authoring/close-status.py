from pathlib import Path
import json
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2];p=ROOT/'docs/STATUS.md';before=p.read_text();r=json.loads((OUT/'results.json').read_text());assert r['ok'] and r['fullApplication']['counts']['pass']==3752 and r['prepared']['groups']==362
with (OUT/'status-before-closing.txt').open('x') as f:f.write(before)
text='''本轮[批量复制验收](test-results/scene3d-copy-authoring/results.json)在隔离副本执行：固定 Node **24.21.0** 完整应用 **3752／3752**、**636** 文件语法／API／版本检查、Rust **290** 项（241单元＋49集成，新增16项）均通过。新增桥接／提案 **29** 项及 **19** 原生／WASM对照、共享核心回归 **407** 项、界面／翻译 **82** 项、来源宿主 **6** 项、模块装配 **49** 项与独立语义 **15** 组／界面归属 **7** 组分别记录；这些范围重叠，不能相加。本轮产品检查均首跑通过，无失败、跳过、取消或todo；验证记录汇总器在执行前适配现存报告字段，未修改冻结产品或重跑已通过的测试。版本保持 **0.0.10**，没有新提交、推送或安装；实际工程与验证副本的字节一致性由单独写回记录确认。

[准备副本](test-results/scene3d-copy-authoring/prepared-final-binding.json)实际 **362** 组，两端各181组／107模块；旧 **346** 组回执逐项保持，桌面／移动／作品库库存 **575／256／11** 文件核对。真实Chrome新复制8与旧对象管理9、平移8、分布8、只读预览7，共 **40** 类流程分别验证，中英日390px、零偏移、隐藏选择、64复制到128、整批拒绝、普通保存／重开、外部冲突和无WebGL均分证。**14** 张代表截图已目视，全部产出31张不都视作目视验收。**767** 份冻结源码、**5075** 份旧证据、**41** 作者文件和 **4** 外部工具的边界核对；新WASM **589027** 字节及旧564571字节真实兼容记录保持。图谱追加至 **94** 功能／**231** 实现／**365** 绑定／**1460** 稀疏评分单元，旧评分、理由、证据、工作流和完整1350项来源快照原样保留，当前必要来源摘要另刷新。标准VM与SwiftShader软件WebGL只证明相应准备副本和浏览器边界，不提升已安装版、Android设备或硬件GPU验收。

'''
marker='上一分布专题在 0.0.10';assert before.count(marker)==1;p.write_text(before.replace(marker,text+marker,1));assert p.read_text().replace(text,'',1)==before
print('Only two present-evidence closing paragraphs inserted')
