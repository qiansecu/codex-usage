# 安装与日常使用

## 前置条件

安装PowerShell 7、Node.js 22或以上、Python 3.10或以上，并确认 `pwsh` 在PATH中。工具不自动下载安装这些程序。桌面客户端需使用Microsoft Store的`OpenAI.Codex`安装包，先按正常方式登录。

首次从项目根目录双击start.cmd，会先生成UI和可选统计启动器，随后显示安装完成提示。已有成功启动的本地设置时，start.cmd保留日常直接启动行为，不重复安装弹窗；更新安装后想再次显示提示，可运行scripts/setup.cmd。

客户端正在运行时，弹窗明确提醒窗口及后台进程将退出、任务可能中断，请先保存工作。只有点击“保存并重启”才会请求关闭已核验的客户端，再从新统计启动器打开；默认焦点及默认回车均为“稍后再说”，Esc或关闭弹窗也会推迟。没有运行的客户端时，按钮为“立即启动”，仍需确认。

先请求正常关闭；如果仍有窗口或保存提示未关闭，会停止并提示手动处理，不强制结束该窗口。窗口已退出而后台进程仍在时，仅清理用户确认过、PID/路径/创建时间一致的安装包进程。期间出现新进程或身份变化则停止，不按程序名批量结束，也不清理Node/Python或其他代理进程。

若希望先构建和检查、暂不启动、不弹出提示，可运行：

```powershell
pwsh -NoProfile -File .\scripts\setup.ps1 -PrepareOnly
```

这一步只生成 `app/footer-page.js` 和可选 `launcher/ChatGPT-Usage.exe`。编译器不可用时，确认后的启动和快捷方式会使用PowerShell注入入口。显式加-Shortcuts仍会提前设置真实快捷方式；AI或自动检查的准备命令不应加该参数。

安装提示选择稍后后，随时可以再次运行start.cmd。高级用户也可手动完整退出客户端后运行app/start-installed.ps1；日常统计快捷方式和这个直接启动脚本仍不会自动重启已经运行的客户端。启动前会核验解释器、会话目录、注册包和统计入口；无法确认时保留现有窗口。

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

首次安装若同名入口指向其他目标，会保留原入口，并在桌面和开始菜单统一改用Codex Meter（必要时带编号）。本工具已记录的入口若被用户后续修改，仍会保留并报告；看app/runtime-installed/shortcut-error.json，处理后可运行launcher/set-default.cmd重试。快捷方式错误不会关闭已经工作的客户端。原同名统计入口备份在launcher/state中，卸载前保留。

成功启动后，Node/Python/CodexHome三个路径保存到app/settings.local.json。后续无相应环境变量时沿用；显式参数/环境变量可以覆盖。该文件只属于本工具，不复制官方config/auth，不应提交Git。

## 停止与卸载

1. 保存当前工作，运行 `app/restore-installed.cmd`，关闭本次调试客户端并结束统计。
2. 若设置过快捷方式，运行 `launcher/restore-shortcuts.cmd`，再自行取消固定旧的统计入口。
3. 从原生入口确认普通客户端可用，然后可以删除工具目录。

身份检查不匹配时不会按程序名批量退出。请手动关闭对应窗口并重新从统计入口启动，不要修改运行记录中的PID来绕过核验。卸载前保留 `launcher/state/`；它包含恢复原同名快捷方式所需的备份。

安装确认框采用本地WPF圆角卡片和胶囊按钮，跟随Windows应用浅色/深色设置；不会联网加载页面。回车默认稍后、Esc及关闭均取消，点击主按钮才确认启动或重启。

让AI安装时，具备正常桌面权限的AI可以在准备后直接调用scripts/setup.ps1打开确认框，用户只需决定是否启动或重启。无需install-test.cmd；受限执行环境仍需正式手动入口。
