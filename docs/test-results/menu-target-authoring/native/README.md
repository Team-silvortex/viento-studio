# 作者菜单：实际 Godot 与离线 ZIP

[最终回执](verification.json)、[运行日志](run.log)全部通过。直接消费本轮界面保存的 22 文件作者内容，原始和离线各 **5 阶段／5 次场景访问／17 条严格读者验证的业务事件／5 张 PNG**。

流程为鼠标 go → Result，Tab／Enter back → Start，Tab／Enter retry → Game，鼠标 back → Start，鼠标 Exit 正常结束。点击使用 Godot 真实 Button 的只读矩形与 XTest 鼠标／键盘事件。每个导航手势长按 350 ms，释放前访问序号不变化；retry 的空覆盖没有凭空建立状态，读到的状态仍为 {}。没有调用按钮信号、导航端口或改写游戏状态来代替操作。

正式[派生工程 ZIP](menu-targets.viento-build.zip)经过既有交付验证与异地展开。本次构建所用的作者副本和构建目录已改名、原路径不可访问后，异地工程再次执行同一流程。作者原文、全部登记生成文件和测试来源的前后哈希一致；界面证据原件保留用于核对，并未被改名或删除。

[observer.gd](observer.gd)为新增最小只读观察器：只调用一次继承初始化，在独立 ALWAYS 子节点中记录输入与快照并在真实帧后截图，不调用玩法端口、不推进业务时钟或预算；不假定动画、音频、HUD 控制器存在。实际字节与来源哈希均已保存。[keyboard-driver.py](keyboard-driver.py)保留真实驱动；首次误用旧可选动画观察器的测试失败单独保存在[诊断](../failed/README.md)，旧观察器与生成运行代码从未修改。

Godot 4.7.2 viento-audiofix1／Xvfb／Mesa 软件渲染；不代表硬件 GPU、安装程序或物理设备验收，也不是整款游戏从空白完成。
