# 发布到GitHub

项目仓库为 [qiansecu/codex-usage](https://github.com/qiansecu/codex-usage)，项目名称为Codex Meter，采用MIT许可证，版权行使用项目contributors署名。首次发布前的本地检查范围见RELEASE-CHECKS.md。后续发布也应以实际推送和CI结果为准。

## 发布前核对

1. 选择仓库名、可见性、开源许可证和署名，并确保有权授权仓库中所有源码。不复制客户端安装包或原生资源。
2. 按 `DEVELOPING.md`运行生成、检查和可选启动器/快捷方式测试；执行公开文件检查。
3. 查看 `git status --short` 和 `git diff --cached`。公开内容仅包括源码、合成测试、文档和CI配置；不包含自己的运行记录、登录信息、聊天截图或快捷方式恢复备份。
4. 确认README的兼容范围准确；另一台电脑的首次安装尚未验收时保留这一说明。
5. 生成初始提交后，推送到作者明确选择的空仓库。不要覆盖已有仓库历史或强制推送。

`scripts/check-public.mjs`不能替代人工审阅；`.gitignore`也不能清除已有Git历史中的秘密。

## 源码与Release

GitHub自动生成的源码ZIP不包含生成程序，首次启动会在本机生成UI。`scripts/setup.cmd`可预先完成构建；`start.cmd`自动生成UI、启动并在确认成功后创建独立入口，不需要发布个人构建的EXE。

从1.1.0起，推送与app/version.json一致的v版本标签，会触发Release工作流：检查通过后打包源码及manifest.json，发布codex-usage.zip。只推送main不会创建Release。更新包不含生成EXE或个人运行目录；具体步骤见[自动更新与发布](UPDATES.md)。已发布的版本标签不随之后的文档修订移动。

## 发布后的维护

Issue应要求客户端版本和去除私有信息的错误片段，拒绝要求用户上传完整会话/配置。修复后更新CHANGELOG和兼容表，区分自动测试通过与真实客户端验证。


## Windows中文路径：发布入口必须统一UTF-8

曾多次出现：工具环境预检通过，用户双击同一个发布入口却报Unexpected repository location。2026-10-31新入口再次漏掉编码初始化，Git输出的中文目录被按不同控制台编码解码，造成路径校验误判。首次上传入口已处理过此问题，重写或更换入口时必须保留。

在调用Git以及比较Git返回路径之前设置：

```powershell
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
```

路径仍须经过GetFullPath规范化并与预期仓库比较。不要删除路径、提交、目标仓库或署名核验来绕过错误；实际移动目录也可能触发同一提示，应先分辨。

发布前必须在含中文及空格的实际项目路径中，模拟非UTF-8控制台运行仅预检模式，例如先把Console.OutputEncoding设为936，再运行发布入口的CheckOnly模式。确认无联网、无推送的预检仍通过；然后在普通桌面实际上传，并以远端提交及Actions结果确认成功。只在维护者工具的默认UTF-8环境测试不足以覆盖该问题。
