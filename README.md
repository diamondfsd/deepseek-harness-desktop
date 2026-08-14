# deepseek-harness-desktop

这是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Electron 桌面封装项目。它使用 Electron 和 Vite，将主仓库的 Web 应用及运行时一起打包成桌面应用，用户打开应用即可使用，不需要手动执行 `pnpm install`、`pnpm run build` 或 `pnpm dsh web`。

本项目只负责桌面窗口、运行时部署和安装包生成，DeepSeek Harness 的核心功能及 Web UI 仍以主仓库为准。

## 相关链接

- [DeepSeek Harness 主仓库](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness Releases](https://github.com/deepseek-ai/deepseek-harness/releases)
- [官方文档](https://github.com/deepseek-ai/deepseek-harness/tree/main/docs)
- [问题反馈](https://github.com/deepseek-ai/deepseek-harness/issues)
- [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- [DeepSeek 官网](https://www.deepseek.com/)

## 技术栈

- Electron `43.4.0`
- Vite `7.3.6`
- electron-vite `5.0.0`
- electron-builder `26.15.3`
- Node.js `>=22.12.0`
- pnpm `11`

## 项目目录

默认情况下，桌面项目和主仓库放在同一个目录下：

```text
~/projects/deepseek-harness/
~/projects/deepseek-harness-desktop/
```

桌面项目会从 `~/projects/deepseek-harness` 构建当前版本的运行时。也可以通过 `DSH_REPO` 指定其他主仓库路径。

## 开发和打包

```sh
cd ~/projects/deepseek-harness-desktop
pnpm install
pnpm run dev
```

生成 macOS 安装包：

```sh
pnpm run package:mac
```

生成目录版应用进行本地测试：

```sh
pnpm run package:dir
```

Windows 和 Linux 请分别执行 `pnpm run package:win` 或 `pnpm run package:linux`。所有产物都会生成到 `release/` 目录。

打包前会从主仓库构建运行时，并将运行时依赖一起放入安装包。因此最终用户不需要安装 Node.js、pnpm，也不需要打开终端执行命令。

## GitHub Actions 发布

仓库中的 `Release Desktop App` 工作流会从 DeepSeek Harness 主仓库读取 `apps/cli/package.json` 的版本，并分别构建 Windows x64、macOS Intel 和 macOS Apple Silicon 安装包，最后创建一个 GitHub Release。

推送到 `main` 分支会自动运行工作流，并使用 GitHub Actions 的运行序号作为 `build.n`。例如上游版本为 `0.1.0-rc.5`，第 `3` 次运行会生成 `0.1.0-rc.5-build.3` / `v0.1.0-rc.5-build.3`。

也可以在 GitHub 的 Actions 页面手动运行工作流：

1. `upstream_ref` 填写主仓库分支或标签，默认是 `main`。
2. `build_number` 可选；不填写时同样使用 GitHub Actions 运行序号。

也可以直接推送 `v*` 标签触发发布，例如 `v0.1.0-rc.5-build.1`。这种方式会使用标签本身作为安装包版本。

## Listen 和数据目录

桌面应用启动时会在本机启动 DeepSeek Harness Web 服务。服务固定绑定到 `127.0.0.1`，端口使用 `0` 由操作系统自动分配，每次启动端口可能不同；Electron 会自动连接该服务，用户不需要手动访问端口。

服务只监听本机回环地址，不直接暴露到局域网。应用关闭时会自动停止该 Web 服务。

用户数据保存在 Electron 的 `userData/harness` 目录中，包括设置、凭据、会话和存储数据。主仓库目录只作为构建源目录，不作为用户数据目录。

## 跟进主仓库更新

推荐使用一条命令拉取主仓库的最新提交并重新打包：

```sh
cd ~/projects/deepseek-harness-desktop
pnpm run update
```

该命令会在默认主仓库中执行 `git pull --ff-only`，然后执行完整的桌面打包流程。`--ff-only` 不会自动创建合并提交；如果本地主仓库无法快进更新，命令会停止并保留现场。

如果使用其他主仓库：

```sh
DSH_REPO=/path/to/deepseek-harness pnpm run update
```

只检查当前主仓库版本而不拉取或打包：

```sh
pnpm run sync
```

主版本、功能和兼容性以 [DeepSeek Harness 主仓库](https://github.com/deepseek-ai/deepseek-harness) 的版本和发布说明为准。桌面项目的 `version` 只控制安装包版本，不代表独立的 Harness 功能版本；每次主仓库更新后都应重新执行 `pnpm run update` 并重新分发安装包。

## 许可

DeepSeek Harness 由 DeepSeek 开发，使用 [MIT License](https://github.com/deepseek-ai/deepseek-harness/blob/main/LICENSE) 发布。本项目打包并分发 DeepSeek Harness 运行时，随项目保留上游 MIT 许可声明，完整文本见 [LICENSE](LICENSE)。第三方依赖的许可信息以主仓库的 [THIRD_PARTY_NOTICES.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/THIRD_PARTY_NOTICES.md) 为准。

## 免责声明

本项目是桌面打包层，不是 DeepSeek Harness 主仓库的替代品。主仓库仍处于快速迭代阶段，更新可能包含不兼容变更；使用前请查看主仓库的版本说明和文档。
