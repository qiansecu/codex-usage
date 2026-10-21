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

当前不自动发布二进制、不自动创建Release。以后若添加成品ZIP，只从经过审阅的Git提交构建，重新检查压缩包文件清单，不能直接打包自己正在使用的目录。可执行文件需要另外说明签名、构建方式与验证状态。

## 发布后的维护

Issue应要求客户端版本和去除私有信息的错误片段，拒绝要求用户上传完整会话/配置。修复后更新CHANGELOG和兼容表，区分自动测试通过与真实客户端验证。
