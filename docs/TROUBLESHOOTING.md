# 问题排查与版本更新修复

本工具使用非正式界面扩展方式。以下是已核对的依赖位置，不代表未来版本保持不变。

## 先查现象

| 现象 | 优先检查 |
| --- | --- |
| 所有统计都消失 | 是否从统计入口启动；`app/runtime-installed/launch-error.json`和`injector-error.log`，查看最新时间 |
| 只剩单轮/底部，额度卡消失 | `injector.log`的`binding-status.header.sidebarState`、`quotaVisible`及侧栏结构 |
| 额度有数据但工作区按钮不可用 | `workspaceState`，原生资源模块哈希和导出名 |
| 额度显示“—” | `quotaState`、更新时间、原生接口或账号切换；未知不代表0或100 |
| 单轮用量消失、底部正常 | 时间节点和真实轮次ID是否改变 |
| 数据不跟随聊天或缺失 | DOM会话标识、路由、本地记录和`display-data.json`；不可按第N条回复猜匹配 |
| 菜单位置或样式异常 | 头像按钮、`aria-controls`、Radix外框、原生surface样式和主题变量 |
| 进程/PID/监听不匹配 | 更新后可能仍有旧记录，正常退出再从统计入口启动，不删除身份核验 |

日志在 `app/runtime-installed/`；`status.json`是最近状态，`package.json`是本次启动时记录的包版本，`session.json`和`page-target.json`是进程/页面身份，不是手工配置。分享时先去除私有内容。

## 启动和连接

`app/start-installed.ps1`通过注册包清单计算安装路径；包家族目前为 `OpenAI.Codex_2p2nqsd0c76g0`，激活入口 `!App`。exe布局、激活或参数支持改变时，需同时检查 `reload-statistics.ps1` 与 `installed-helpers.psm1`。

`app/injector.mjs`先使用本机HTTP发现页面，再用本机WebSocket连接。`validTarget()`限制应用页面与本次端口，`selectTarget()`复用同次启动已确认的页面ID；多候选不能任取第一个。若新版完全不支持调试参数，需要重新评估方案，不能通过开放网卡监听或放松进程核验解决。

## 会话和单轮定位

`app/footer-controller.js`的 `composers()`、`identity()`、`turnCandidates()`、`scan()` 当前依赖：

- `[data-codex-composer-root]`，回退 `form[data-chatgpt-composer]`。
- `data-conversation-id`、`data-above-composer-conversation-id`，路由 `/local/<UUID>` 或 `/thread/<UUID>`。
- 时间节点 `[data-assistant-message-sent-time]`。
- 轮次祖先节点 `data-content-search-turn-key`、`data-content-search-unit-key`。

属性名改变时同时修改MutationObserver的attributeFilter和 `header-controller.mjs` 的会话回退逻辑。继续把单轮标签挂在原生时间节点内，继承悬停显隐和字号。

## 额度卡与原生菜单

`header-controller.mjs/findSidebar()`优先使用已确认侧栏内的 `[data-sidebar-navigation-root]`，无新版候选时回退 `nav[role="navigation"]`；约束 `.app-shell-left-panel`、`.sidebar-navigation`、布局、宽度和可见性，排除inert，多候选拒绝挂载。

`findActions()`约束标题栏聊天操作按钮、`role="toolbar"`及`app-shell-header-toolbar`操作行。额度开关使用唯一原生profile menu按钮定位其最近的group/sidebar-rail，在包含头像的直接rail子项前插入自己的button。头像不再被禁用或转发事件，菜单完全使用原生位置与关闭行为；额度卡本身不可点击。

当前布局为76px固定卡片、左右/底边12px、圆角16px、padding9px 15px；条高6px，文字/条gap3px，组间gap11px，周组上移1px。不要恢复旧的输入框高度跟随。头像账号菜单沿用原生位置，不再按额度卡重定位。开关36px、图标20px、aria-pressed表示显示状态；localStorage只保存独立可见性键。颜色/描边/投影尽量复用新版原生菜单计算样式。

## 容易失效的原生模块

工作区服务当前有两组经过只读核对的模块/导出：

| 客户端 | 资源 | 服务导出 |
| --- | --- | --- |
| 26.1013.4894.0 | `/assets/app-shared-bbfeca5e5737.js` | `Kat` |
| 26.1007.9446.0 | `/assets/app-shared-30671c57ec82.js` | `fN` |

默认优先导入新版资源，加载失败回退旧版。`nativeService()`校验`openIn.open`与`openIn.getTargets`；压缩导出名和文件哈希都可能再变。不能只换哈希或猜导出名，须沿新版实际调用核对参数、返回值和`fileManager`目标。

通过已注册包定位 `app/resources/app.asar`，使用只读ASAR查看方式寻找 `webview/assets/` 中的 `openIn`、`getTargets`、`fileManager`等语义线索。不复制这些资源到仓库，不回写安装目录，不打印整份压缩源码。目录打开仍须在点击时重读匹配的`thread.cwd`，调用过程中切换聊天则取消。

额度通过 `electronBridge.sendMessageFromView` 的本机请求读取 `account/rateLimits/read`，监听 `account/rateLimits/updated` 与 `account/updated`；优先`rateLimitsByLimitId.codex`，窗口300/10080分钟，剩余为100-usedPercent。信封或字段变化时需核对真实响应，保留请求相关性和账号切换竞态保护。

额度开关图标优先使用26.1013.4894.0的shared模块aS资产（gauge-light-16）和oS初始化器，仅在已核对的Kat.openIn结构存在时调用。只提取合法path几何，不复制HTML/事件；资源不可用则保留本地自绘fallback。此依赖也需随版本核对，不可猜测未知模块的初始化函数。

## 本地记录变化

`usage_backend.py`/`usage_collector.py`依赖会话元数据、turn_context、任务/响应、token_count和耗时事件；`data-binding.mjs`做ID与累计核验。字段或格式改变时使用去私有信息的合成样本补充行为测试。缺失值和真实0不能混同，缓存输入不重复计入总量，不捏造上下文分类。

## 修改后生效与验收

UI源码修改后运行 `app/build-ui.cmd`，已连接的注入器自动加载；注入器或数据后台修改后重载统计；启动器修改则正常退出后重新启动。先运行 `app/check-local.cmd`，再真实验证两条聊天切换、四个详情、额度卡/菜单、工作区目录、附件预览和撤销。模拟DOM测试不能证明新版真实界面兼容。

2026-10-18曾发生实际故障：新版额度数据仍ready，但旧nav定位失效，添加新sidebar root规则后额度卡与菜单经用户确认恢复；工作区模块同时从旧哈希/fN变为新版哈希/Kat。这说明应先分清数据、定位和接口三层，避免整套重写。

每次修复在CHANGELOG记录客户端版本、变化的结构/接口、修改文件、本地检查和人工验证范围。暂时无法修复时先撤销统计并普通启动客户端，不修改用户登录或会话数据。


## 首次安装与运行中遇到的问题

| 问题 | 原因或判断方法 | 处理方式 |
| --- | --- | --- |
| 找不到Node/Python或提示最低版本不足 | 旧脚本依赖维护环境缓存；WindowsApps的python.exe还可能只是商店别名 | 使用Node 22+/Python 3.10+，通过PATH或CODEX_USAGE_NODE/PYTHON完整路径配置。显式指定失效时先修正路径，不悄悄换另一个解释器 |
| 找不到PowerShell 7 | pwsh不在PATH，或未安装 | 安装后重开终端。可选静默启动器优先标准Program Files位置，再找PATH；也可使用直接PowerShell快捷方式 |
| 缺少C#编译器 | 不能生成可选静默EXE | 启动成功后的快捷方式会直接指向PowerShell 7和本项目注入脚本，不必替换原启动器；app/运行记录仍可排查错误 |
| 提示客户端仍在运行 | 商店激活可能复用原进程，原进程未带调试参数 | 保存工作后正常完整退出，包括后台实例，再从start.cmd启动。脚本不会按名称批量杀进程 |
| 只有命令提示符，没有客户端窗口 | 原先实验副本的启动行为和签名/进程条件与安装版不同；自动执行环境也可能不在交互桌面 | 当前仅使用注册安装包激活，不再从旧实验副本启动。优先查看本次launch-error，再由用户交互桌面启动；不复制或替换app.asar |
| 实验副本要求重新登录 | 独立profile不沿用安装版登录状态 | 当前方案沿用普通安装版profile，不要求复制登录文件。不要把凭据迁移当成修复步骤 |
| 120秒仍无调试端口 | 新版可能丢弃调试参数，也可能启动复用了旧进程 | 核对本次包/进程和实际监听；不把端口固定或开放到0.0.0.0。确认版本不支持时先普通启动客户端 |
| 网络重连问题与统计连接混淆 | 页面发现是本机HTTP，控制是本机WebSocket；模型服务网络是另一条链路 | 先分清哪一条失败。额度和本地token更新正常时，不因模型网络问题重写CDP；不盲目关闭代理或TLS校验 |
| 启动已成功，但无快捷方式 | 窗口未确认ready、同名入口冲突、目录权限不足，或可选启动器构建失败 | 看runtime-installed/shortcut-error.json。保持已工作的窗口，排除冲突/权限后可运行launcher/set-default.cmd；绝不覆盖未知同名入口 |
| 从快捷方式启动找不到解释器/会话目录 | 首次终端环境变量未永久保存 | 当前成功启动后记录app/settings.local.json的三个路径，后续沿用；环境变量或显式参数仍可覆盖。路径搬迁后修正该本地文件或重新设置，不复制官方config/auth |
| 点击聊天里的脚本链接只看到源码 | 客户端把文件链接当编辑入口，不会执行脚本 | 在资源管理器双击.cmd，或在PowerShell中执行明确的.ps1路径 |

## 进程身份与重载问题

撤销和重载都核对PID、程序路径及精确创建时间。测试中曾遇到PID被另一进程复用，旧记录不能因此结束新进程；也曾遇到PowerShell把JSON时间转成DateTime对象，字符串再解析丢掉精度。当前保留严格身份比较，启动成功判断也直接保留DateTime的精度。

- 出现“Recorded PID now belongs to a different process”或身份不匹配：让对应窗口正常退出，再从统计入口启动，不改session内的PID或创建时间。
- 出现“Multiple application pages”：检查是否有分离窗口/额外页面。同次启动优先沿用已确认的page-target；旧页面失效时不能任取其他页面。
- 客户端更新后重载失败：旧session可能记录旧包。重载只重新运行统计进程，不会重新激活新包；应退出后启动。
- 修改UI仅需build-ui生成，修改Python、绑定或注入器才需重载。注入器已退出时，仅生成UI不会使它重新运行。
- 快捷方式恢复测试中曾出现“预期拒绝恢复”的非零退出码泄漏，当前测试脚本成功后显式返回0。不能为通过测试而取消保护用户修改的拒绝分支。

## 显示、数据与布局问题

### 切换聊天后加载慢、残留或缺数据

当前按会话ID与真实轮次ID绑定，切换时先隐藏旧数据；加载或本地记录尚未写入时可能短暂空白，超过8秒的显示帧不继续当成新数据。不要按回复显示顺序猜测，也不能用上一条聊天的数字填补空缺。缺失值显示“—”，与真实0不同。

四种详情出现字段缺失时，先区分旧后台未重载与原始记录根本不提供字段。模型用时、工具累计、TTFT、TPS均有具体样本范围；缓存读取属于输入的一部分，不能再次加到总量；继承累计不一定等于本地回复求和。上下文仅估算最近请求，不伪造系统/工具/消息分类。

### 字号、悬停与输入框被挤动

单轮标签附在原生时间节点内，共享时间的悬停/焦点显隐和实际字号。底部摘要在body独立固定定位，不进入输入框排版。不要为了显示标签而强制opacity=1，也不要把摘要追加到输入框的正常布局中。

### 拖入图片使额度卡拉伸或跳动

曾经为与输入框上下对齐而读取composer高度，附件预览、拖拽占位和DOM重建会导致卡片拉伸或跳动。最终方案已取消这种依赖：固定76px卡片，底边12px，内容独立居中。不得重新引入composer高度跟随、拖拽锁定缓存或热加载位置交接来恢复旧方案。

### 额度卡、头像与开关行为

当前额度卡只展示；头像始终打开原生菜单，菜单不再搬到卡片上方。头像上方的独立开关控制卡片和底部防误触区域，localStorage仅记录0/1。找不到卡片时先看quotaEnabled是否为false，再看sidebarState。按钮显示但状态不记忆时检查存储是否受限，不读取或修改其他存储键。

图标最终基线为20px原生gauge细轮廓、未选中text-tertiary浅灰；36px按钮的位置不随图标微调变化。更换尺寸/描边前先对照实际主题，避免用界面截图的缩放像素直接当CSS像素。

### 菜单页/独立小窗的旧实验

早期官方插件页无法在切换聊天后一直保留，独立置顶小窗虽然能常亮但不符合最终会话内布局。这些实验不是当前依赖，重新打开旧插件或小窗不会修复当前会话内显示。独立实验副本的start/restore也不能与安装版入口混用。

## 修复后的验收顺序

1. 先运行生成和源码检查，确认本地合成测试通过；不要把模拟DOM测试当成新版真实界面已兼容。
2. 在真实客户端确认本次日志与版本、两个聊天切换及四个详情。
3. 关闭/打开额度开关，检查头像原生菜单和工作区目录；拖入、移除图片预览，无需发送消息。
4. 检查桌面与开始菜单的两个独立统计入口、目标脚本及原普通入口未变；重复启动不应新增重复项。
5. 如需验证撤销，先保存工作，再退出本次调试实例并普通启动。发布文档只记录实际确认的范围。

恢复原状时运行app/restore-installed.cmd，再运行launcher/restore-shortcuts.cmd。前者会关闭本次调试客户端，后者只恢复本工具记录的同名统计入口。未知用户修改会被保留，不会强制覆盖。


## 快捷方式在其他语言的Windows或CI中保存失败

首次GitHub Windows检查曾在test-shortcuts.ps1的WScript.Shell.Save处失败，路径中的中文被显示为问号。旧WSH接口存在系统ANSI字符集限制；本地使用含中文、其他文字和非BMP字符的路径也可复现，不能仅把测试名换成英文、跳过测试或要求用户更改系统区域设置。

当前launcher/shortcut-native.cs直接使用[IShellLinkW](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishelllinkw)及[IPersistFile.Save](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-ipersistfile-save)创建Unicode快捷方式。shortcut-helpers.psm1提供Read-UsageShortcut/Write-UsageShortcut，正式安装、目标校验与合成测试均使用它。读取时不解析或启动快捷方式目标，原有哈希备份、幂等和用户改动保护继续保留。

若旧版出现Unable to save shortcut且路径文字变为问号，更新整个项目源码，包括这两个辅助文件。仅修改控制台编码不能修复此COM接口的字符转换。运行scripts/build-launcher.ps1、launcher/test-shortcuts.ps1和app/test-startup-helpers.ps1，检查中文及其他字符的文件名、目标、参数、工作目录和图标路径是否完整往返；测试仅使用隔离目录。云端是否已修复仍以对应提交的Actions结果为准。
