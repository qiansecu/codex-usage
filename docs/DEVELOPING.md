# 开发与测试

## 目录

| 目录 | 内容 |
| --- | --- |
| `app/` | UI控制器、注入连接、本地读取器、启动/重载/撤销和测试 |
| `launcher/` | 可选Windows启动器源码、独立快捷方式设置与恢复 |
| `scripts/` | 启动器编译与公开文件检查 |
| `docs/` | 安装、隐私、更新维护与发布说明 |
| `.github/workflows/` | Windows源码检查流程 |

不依赖旧实验目录。未复制用户配置、会话、截图、运行快照、快捷方式备份或桌面客户端资源。原生资源只通过已安装客户端按需加载。

## 常用命令

在仓库根目录运行，需已安装前置运行时：

```powershell
pwsh -NoProfile -File .\app\build-ui.ps1
pwsh -NoProfile -File .\app\check-local.ps1
pwsh -NoProfile -File .\scripts\build-launcher.ps1
pwsh -NoProfile -File .\launcher\test-shortcuts.ps1
pwsh -NoProfile -File .\app\test-startup-helpers.ps1
node --test .\scripts\test-public.mjs
node .\scripts\check-public.mjs
```

最后一项需在Git仓库内执行；同时检查已跟踪与未忽略的新文件。快捷方式测试只使用自己创建的合成链接，不读取或更改真实桌面/开始菜单入口。预期的“用户修改后拒绝恢复”分支属于成功测试的一部分。快捷方式统一使用launcher/shortcut-helpers.psm1与shortcut-native.cs的原生Unicode接口，测试目录故意包含多个文字系统和非BMP字符，不依赖测试机的ANSI代码页。

`check-local.ps1`包括Node控制器/绑定/连接测试、Python合成记录测试、PowerShell解析/进程身份测试和解释器发现检查，不激活客户端。CI在Windows运行这些检查，但不安装、登录或实际操作桌面客户端。

## 修改与生效

编辑 `footer-controller.js` 或 `header-controller.mjs` 后运行 `build-ui.ps1`；生成的 `footer-page.js`不提交Git，正常连接中的注入器会自动加载。首次启动也会生成它。

修改注入器、绑定逻辑或Python后端后，运行 `app/reload-statistics.cmd` 重载统计。修改启动/激活逻辑则需要正常退出客户端后重新启动。失效的旧进程记录不能通过编辑PID来修复。

`scripts/setup.ps1`只编译，不启动客户端；加-Shortcuts才提前设置真实入口。正常start成功后也会自动创建入口。测试/CI只使用TestRoot合成桌面，不运行真实安装启动；startup-helpers验证就绪门槛、本地路径记忆和自动创建流程。

## 数据口径

累计输入加输出为总量，缓存读取包含在输入内。缺失字段不伪装为0，继承量与本地量分开说明。单轮按真实轮次ID匹配并核验，不按DOM顺序猜测；多候选或跨聊天旧数据不能启用当前入口。

TPS使用纯文本响应样本的非推理输出除以生成耗时；模型活动取区间并集，工具累计耗时允许包含并行重叠。TTFT取成功完成轮次的有效记录平均。上下文是最近请求用量估算，分类字段不可靠时不展示虚构分类。

新客户端适配须先按 [更新指南](TROUBLESHOOTING.md)核对真实结构，再增加有意义的行为测试。不要仅把断言改成当前输出而不核对语义。
