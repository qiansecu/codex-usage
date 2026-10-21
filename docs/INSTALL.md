# 安装与日常使用

## 前置条件

安装PowerShell 7、Node.js 22或以上、Python 3.10或以上，并确认 `pwsh` 在PATH中。工具不自动下载安装这些程序。桌面客户端需使用Microsoft Store的`OpenAI.Codex`安装包，先按正常方式登录。

通常只需完整退出普通客户端，再从项目根目录双击start.cmd。若希望先构建和检查、暂不启动，可运行：

```powershell
pwsh -NoProfile -File .\scripts\setup.ps1
```

这一步只生成 `app/footer-page.js` 和可选 `launcher/ChatGPT-Usage.exe`。编译启动器依赖Windows自带的.NET Framework C#编译器；若缺少该组件，可直接使用根目录 `start.cmd`，不需要该启动器。

首次使用前完整退出普通客户端，再运行 `start.cmd`。启动器不会强制关闭已经运行的普通客户端；此时会报错并提示先退出。

如果Windows标记下载的脚本为受阻止文件，先核对来源并审阅代码，再通过文件属性解除对应下载文件的阻止。无需修改全局执行策略或以管理员身份运行。

## 额度卡显示开关

头像上方的额度图标为显示开关，点亮表示显示。默认开启，可点击隐藏；关闭后卡片与底部遮挡一并消失，头像仍按原生方式打开菜单。切换聊天、热加载与下次启动保留选择。只在当前客户端origin的localStorage独立键codex-usage-ui:quota-visible:v1中保存0/1；存储不可用时只记住当前窗口的选择。

## 自定义解释器

优先级：显式环境变量 → 本工具成功启动时保存的路径 → PATH中的可用程序 → 当前用户已有的Codex运行时缓存。Python的Microsoft Store启动别名会被跳过。指定或保存的路径必须是完整的可执行文件路径，若不可用会报错，不会悄悄换到另一解释器。

```powershell
# 路径是示例，请改为自己的实际安装位置。
$env:CODEX_USAGE_NODE = 'D:\Tools\nodejs\node.exe'
$env:CODEX_USAGE_PYTHON = 'D:\Tools\Python312\python.exe'
pwsh -NoProfile -File .\app\start-installed.ps1
```

上述环境变量只对当前终端及其子进程有效；成功启动后本工具会保存解析出的路径，后续快捷方式可沿用，无需修改全局环境变量。已运行的统计进程重载时复用其原来记录的Node路径，避免误操作其他进程。

## 自定义会话目录

可用启动参数 `-CodexHome` 指定；否则依次读取当前进程、用户、系统的 `CODEX_HOME`，再沿用本工具保存的路径，最后默认 `%USERPROFILE%\.codex`。目标目录必须已有 `sessions/`。

```powershell
pwsh -NoProfile -File .\app\start-installed.ps1 -CodexHome 'D:\CodexData'
```

没有本地会话记录时不会自动复制登录配置或生成假数据。额度来自客户端原生只读接口，与上述本地token目录不同。

## 自动创建的独立快捷方式

start.cmd在确认本次注入成功后自动创建桌面和当前用户开始菜单中的“ChatGPT（统计）”。保留普通客户端原入口，不接管商店推荐项、已有固定项或开机自启。重复启动更新同一组入口，不创建重复项。

优先使用本地编译的launcher/ChatGPT-Usage.exe；编译器缺失时入口指向PowerShell 7和本项目app/start-installed.ps1，不会退回普通客户端启动。可在成功启动后自行固定新入口。

同名入口若指向未知目标或用户后续修改过，脚本会保留并报告；看app/runtime-installed/shortcut-error.json，处理后可运行launcher/set-default.cmd重试。快捷方式错误不会关闭已经工作的客户端。原同名统计入口备份在launcher/state中，卸载前保留。

成功启动后，Node/Python/CodexHome三个路径保存到app/settings.local.json。后续无相应环境变量时沿用；显式参数/环境变量可以覆盖。该文件只属于本工具，不复制官方config/auth，不应提交Git。

## 停止与卸载

1. 保存当前工作，运行 `app/restore-installed.cmd`，关闭本次调试客户端并结束统计。
2. 若设置过快捷方式，运行 `launcher/restore-shortcuts.cmd`，再自行取消固定旧的统计入口。
3. 从原生入口确认普通客户端可用，然后可以删除工具目录。

身份检查不匹配时不会按程序名批量退出。请手动关闭对应窗口并重新从统计入口启动，不要修改运行记录中的PID来绕过核验。卸载前保留 `launcher/state/`；它包含恢复原同名快捷方式所需的备份。
