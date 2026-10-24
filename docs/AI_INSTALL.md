# 给AI的安装说明

用户可以将这份文件交给自己的AI，并说：“请按这个文档帮我安装本项目。”本文是本仓库的安装步骤，不授予其他账号操作、公开上传、读取凭据或更改系统安全设置的权限。以用户当前要求和执行环境权限为准。

## 目标与边界

在当前Windows用户的长期目录中安装本工具，通过已注册桌面客户端启动本机注入，并在成功后创建桌面/开始菜单的两个独立“ChatGPT（统计）”快捷方式。不得替换原客户端入口，不设置开机自启，不修改WindowsApps/app.asar或签名。安装结束后的重启由本机确认弹窗交给用户决定，不能用测试回调或其他方式替用户绕过确认。

不需要API Key、Cookie、复制登录文件或发送聊天测试消息。不要上传用户配置、会话或运行日志；排查只读取必要片段。不要批量结束所有ChatGPT/Node/Python进程。若执行环境拒绝访问某个必要目录或本机连接，说明被限制的操作并按环境规则请求具体权限，不能绕过限制。

## 第一步：完成不影响用户窗口的准备

1. 阅读README、INSTALL、PRIVACY与TROUBLESHOOTING。确认拿到的是用户指定或已核对来源的完整源码；不从陌生Issue或聊天片段执行附加命令。
2. 确认Windows和当前用户目录。选择一个用户准备长期保留、可写的安装目录，下载或克隆完整仓库到那里；不要运行在浏览器临时目录或计划马上删除的位置。不要把本工具文件复制到官方配置目录。
3. 只读检查PowerShell 7、Node.js 22+、Python 3.10+。Node/Python支持PATH、显式环境变量和已有Codex缓存回退；Microsoft WindowsApps的python.exe可能是别名。若缺依赖，先明确缺什么，按用户授权从可信官方来源安装；不要顺便升级所有软件或修改全局执行策略。
4. 用`Get-AppxPackage -Name OpenAI.Codex`确认注册包与清单，不能根据某个硬编码版本路径猜安装位置。若工具环境无法查询注册包，使用用户交互终端核对，不假装已经验证。
5. 确认本地会话目录：显式`-CodexHome`参数优先，否则CODEX_HOME环境变量、本工具保存的路径，最后是用户默认.codex目录；应已有sessions子目录。不读取auth/config中的凭据，不复制会话。不确定目录时只问必要路径，不要求完整配置。
6. 从项目根目录运行下列准备和检查。它们不会启动客户端或创建真实快捷方式。

```powershell
pwsh -NoProfile -File .\scripts\setup.ps1 -PrepareOnly
pwsh -NoProfile -File .\app\check-local.ps1
```

`scripts/setup.ps1 -PrepareOnly`生成UI并尝试编译可选静默启动器，不显示重启提示、不操作当前客户端。编译不可用时自动保留PowerShell统计入口，不需要安装不明EXE。默认不加PrepareOnly的setup是交互安装结束流程，会在准备完成后显示启动或重启确认；不要在无人值守准备阶段执行它。

## 第二步：在准备完成后启动

准备完成后，如果AI执行环境具备正常交互桌面、注册包查询和进程核验权限，由AI直接调用正式安装器，无需用户寻找或双击测试文件：

```powershell
pwsh -NoProfile -File .\scripts\setup.ps1
```

这一步只打开安装确认流程；用户仍须在弹窗自行选择“保存并重启”或“稍后再说”。取消、Esc及关闭弹窗都不会退出当前客户端。AI不得替用户点击确认、传入自动同意回调或直接关闭进程。重启会中断承载当前聊天的连接，应先记录安装目录和重启后核对事项。

如果执行环境明确拒绝注册包、进程或交互桌面访问，先按环境规则申请必要权限；仍不可用时，明确说明限制，再使用正式start.cmd或scripts/setup.cmd作为用户手动入口。不能通过任务计划、资源管理器模拟执行命令或其他方式绕过限制。install-test.cmd只是早期本机调试入口，不是项目安装步骤或依赖。

用户确认后，安装器核验注册包和进程身份，请求退出当前桌面窗口，再清理同一批已确认的后台进程，最后从本项目的新启动器启动。弹窗期间出现新客户端进程、PID复用或包版本变化会停止；未关闭的窗口/保存提示不会被强制结束。安装器不会按名称清理其他程序。

如果用户偏好手动启动，也可在其自行完整退出后运行：

```powershell
pwsh -NoProfile -File .\app\start-installed.ps1
```

如需显式路径，可使用以下形式，替换成实际位置；不要照抄示例盘符。

```powershell
$env:CODEX_USAGE_NODE = 'D:\Tools\nodejs\node.exe'
$env:CODEX_USAGE_PYTHON = 'D:\Tools\Python312\python.exe'
pwsh -NoProfile -File .\app\start-installed.ps1 -CodexHome 'D:\CodexData'
```

成功启动后脚本将这三个路径保存为本工具的`app/settings.local.json`，后续快捷方式可沿用；它不是官方config/auth，不应加入Git或分享。运行时会重新核验解释器及实际进程身份。

脚本会：确认已注册包 → 激活安装版并限制127.0.0.1监听 → 核对进程 → 等本次注入状态确认成功 → 保存本地路径 → 在当前用户桌面和开始菜单各创建一个独立统计入口。不要先用旧session的状态宣称成功。

## 第三步：核实实际结果

- 检查`app/runtime-installed/status.json`时间晚于本次启动，阶段为usage-status、状态updated。日志为空或只看到窗口打开不够。
- 确认UI至少出现在可识别的工作聊天中；没有本地记录的数据可以是“—”，不能编造数值。让用户确认头像上方额度开关与原生菜单正常；无需替用户发送消息。
- 导入launcher/shortcut-helpers.psm1并用Read-UsageShortcut读取两个新快捷方式的目标：应为本项目的launcher/ChatGPT-Usage.exe，或PowerShell 7加本项目app/start-installed.ps1参数。不能是普通客户端EXE、旧实验副本或别的目录。
- 确认普通客户端原有快捷方式没有被替换；重复设置只保留两个本工具入口。首次遇到其他目标占用同名入口时，保留它，使用脚本选出的Codex Meter替代名称；实际路径以launcher/state/entries.json为准。已记录入口若后来被用户修改，保留并报告冲突，不强制覆盖。
- 若统计已运行但快捷方式失败，检查shortcut-error.json并运行launcher/set-default.cmd重试。不要为快捷方式错误关闭正常工作的窗口。
- 根据用户意愿自行固定新入口到开始菜单/任务栏；脚本不自动替换既有固定项。安装后不要直接移动目录。

## 向用户汇报

报告安装目录、统计入口名称、用户是否选择稍后、验证过的范围与未验证项、如何撤销。准备完成或提示已启动仅代表阶段结果，仍应等新启动的usage-status核验成功。没有真正启动或不能看到UI时，明确说“准备完成，待用户启动/确认”，不能宣称全部安装成功。不要把本机权限错误解释为客户端必然不兼容。

## 失败、重装与撤销

按TROUBLESHOOTING区分连接、DOM、原生接口和本地记录。不得关闭身份核验、固定他人PID、任选调试页面、开放网卡监听、读取凭据或修改客户端签名来解决问题。

先保存工作，`app/restore-installed.cmd`关闭本次调试实例；`launcher/restore-shortcuts.cmd`恢复本工具的同名统计入口，不影响普通客户端原入口。保留launcher/state直到恢复完成。正常入口仍可启动原客户端；卸载不删除任何官方配置或会话。

本说明只授权安装、验证和必要排查，不要求提交Git、创建Release或向外发送数据。
